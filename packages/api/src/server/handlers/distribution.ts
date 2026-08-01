import { type Hono } from 'hono';

import { type Db } from '../db.js';
import { type AppEnv } from '../principal-context.js';
import { type DistributionGrant, createDistributionResolver } from '../store/bundles-store.js';

/** Contador de quota por token — janela fixa em memória, como o rate limiter do M17. */
/**
 * Acima disto a varredura de buckets vencidos roda. Bem acima do número de credenciais ativas
 * que um publisher real tem, para que o caminho quente quase nunca a pague.
 */
export const DESPEJO_ACIMA_DE = 4096;

/**
 * Remove os buckets já vencidos, quando a tabela passa do limiar.
 *
 * Função pura e exportada porque é a única forma honesta de testá-la: disparar o despejo por
 * requisições exigiria 4096 chamadas, e um teste desses seria lento e frágil o bastante para
 * ser desligado no primeiro dia ruim.
 *
 * Varre em lote e não a cada requisição: percorrer o mapa inteiro no caminho quente trocaria
 * um vazamento lento por uma latência constante, que é pior.
 */
export function despejarVencidos(
  buckets: Map<string, QuotaBucket>,
  agora: number,
  limiar: number = DESPEJO_ACIMA_DE,
): number {
  if (buckets.size <= limiar) return 0;
  let removidos = 0;
  for (const [k, v] of buckets) {
    if (agora >= v.resetAt) {
      buckets.delete(k);
      removidos += 1;
    }
  }
  return removidos;
}

interface QuotaBucket {
  count: number;
  resetAt: number;
}

export interface DistributionRoutesDeps {
  readonly db: Db;
  /** Registra a instalação (M21). Ausente = telemetria desligada. */
  readonly recordInstall?: (e: {
    workspaceId: string;
    bundleId: string;
    tokenId: string;
    skillId: string;
    revisionId: string;
    version: string | null;
  }) => Promise<void>;
  /**
   * Resolve `canal → revisão + versão` para a telemetria (M21).
   *
   * A adoção gravava o NOME do canal na coluna da revisão e `version: null` fixo, e o
   * relatório agrupa por versão — então ele inteiro colapsava numa linha nula. "Uma
   * instalação foi contabilizada" era verdade; "com que versão" nunca teria resposta, que é
   * a única pergunta que o publisher faz do relatório.
   */
  readonly resolveChannel?: (
    workspaceId: string,
    skillId: string,
    channel: string,
  ) => Promise<{ revisionId: string; version: string | null } | null>;
  /** Quota padrão por token, quando o token não declara a própria. */
  readonly defaultQuota: number;
  readonly windowMs: number;
  readonly now?: () => number;
  /** Store de adoção escopado ao publisher (M21). */
}

/**
 * Rotas de DISTRIBUIÇÃO (M20 DoD #3 e #4) — a superfície que o cliente do nosso cliente usa.
 *
 * São deliberadamente separadas das rotas internas (`/v1/skills`): quem chega aqui não é
 * membro de workspace algum, não tem papel, e não deve enxergar nada além do bundle que o
 * token concede. Reaproveitar as rotas internas exigiria enxertar um caminho de exceção em
 * cada uma delas — e um caminho de exceção esquecido numa rota é o vazamento inteiro.
 */
export function registerDistributionRoutes(app: Hono<AppEnv>, deps: DistributionRoutesDeps): void {
  const resolver = createDistributionResolver(deps.db);
  const now = deps.now ?? (() => Date.now());
  const buckets = new Map<string, QuotaBucket>();

  /** Extrai e resolve o token, ou devolve `null` (o chamador responde 404). */
  const grantFrom = async (auth: string | undefined): Promise<DistributionGrant | null> => {
    const m = /^bearer (.*)$/is.exec(auth ?? '');
    const token = m?.[1];
    return token === undefined ? null : resolver.resolve(token);
  };

  /** `true` quando a requisição cabe na quota. */
  const withinQuota = (grant: DistributionGrant): { ok: boolean; retryAfter: number } => {
    const limit = grant.quotaPerWindow ?? deps.defaultQuota;
    const t = now();
    let b = buckets.get(grant.tokenId);
    if (b === undefined || t >= b.resetAt) {
      b = { count: 0, resetAt: t + deps.windowMs };
      buckets.set(grant.tokenId, b);
    }
    b.count += 1;

    // DESPEJO dos buckets vencidos. Sem isto o `Map` guarda uma entrada por token JÁ VISTO e
    // nunca a remove: com um milhão de credenciais ao longo da vida do processo são dezenas
    // de MB retidos sem uso — um vazamento lento, do tipo que só aparece como reinício
    // periódico que ninguém sabe explicar.
    //
    // Varre em lote e não a cada requisição: percorrer o mapa inteiro no caminho quente
    // trocaria um vazamento lento por uma latência constante, que é pior.
    despejarVencidos(buckets, t);

    return { ok: b.count <= limit, retryAfter: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
  };

  app.get('/v1/distribution/bundle', async (c) => {
    const grant = await grantFrom(c.req.header('authorization'));
    // 404, NUNCA 403: um token inválido, revogado, expirado ou de outro publisher recebe a
    // mesma resposta de "não existe". Distinguir permitiria a um cliente descobrir bundles
    // alheios por tentativa — mesmo contrato de enumeração do M11.
    if (grant === null) return c.json({ error: 'not_found' }, 404);

    const quota = withinQuota(grant);
    if (!quota.ok) {
      // `Retry-After` pelo mesmo motivo do M17: sem ele o cliente retenta na hora e o limite
      // vira amplificador de carga. Aqui é ainda mais grave — quem retenta é o cliente de
      // OUTRA empresa, e a carga cai sobre o publisher que não fez nada.
      c.header('Retry-After', String(quota.retryAfter));
      return c.json({ error: 'rate_limited', retry_after_seconds: quota.retryAfter }, 429);
    }

    // A resposta descreve o bundle SEM revelar o workspace do publisher: o cliente final não
    // precisa saber o identificador interno de quem o atende, e expô-lo daria a ele um dado
    // para correlacionar publishers entre si.
    const { bundles: bundlesTable, bundleItems } = await import('@usetheo/skills/db');
    const { and, eq } = await import('drizzle-orm');

    const rows = await deps.db
      .select()
      .from(bundlesTable)
      .where(and(eq(bundlesTable.workspaceId, grant.workspaceId), eq(bundlesTable.bundleId, grant.bundleId)))
      .limit(1);
    const bundle = rows[0];
    if (bundle === undefined) return c.json({ error: 'not_found' }, 404);

    const items = await deps.db
      .select()
      .from(bundleItems)
      .where(and(eq(bundleItems.workspaceId, grant.workspaceId), eq(bundleItems.bundleId, grant.bundleId)));

    // TELEMETRIA FORA DO CAMINHO DE RESPOSTA (M21 DoD #3).
    //
    // Registrada sem `await` e com o erro engolido DE PROPÓSITO: instrumentar o caminho
    // quente não pode adicionar latência nem, pior, transformar uma falha de telemetria numa
    // falha de instalação. O cliente do publisher não deve ficar sem a skill porque a nossa
    // contagem falhou. O custo assumido é que um evento pode se perder — aceitável para um
    // dado de tendência, inaceitável se fosse cobrança.
    if (deps.recordInstall !== undefined) {
      const registrar = deps.recordInstall;
      const resolver = deps.resolveChannel;
      for (const i of items) {
        void (async (): Promise<void> => {
          // Resolve o canal para a revisão que ele aponta. Um canal ainda não promovido não
          // fabrica revisão: grava o que sabe e a entrega segue — telemetria nunca derruba
          // a distribuição.
          const alvo = resolver !== undefined ? await resolver(grant.workspaceId, i.skillId, i.channel) : null;
          await registrar({
            workspaceId: grant.workspaceId,
            bundleId: grant.bundleId,
            tokenId: grant.tokenId,
            skillId: i.skillId,
            revisionId: alvo?.revisionId ?? i.channel,
            version: alvo?.version ?? null,
          });
        })().catch(() => undefined);
      }
    }

    return c.json(
      {
        bundle_id: bundle.bundleId,
        name: bundle.name,
        skills: items.map((i) => ({ skill_id: i.skillId, channel: i.channel })),
      },
      200,
    );
  });

}

/**
 * `GET /v1/bundles/{id}/adoption` (M21 DoD #2) — só para o DONO do bundle.
 *
 * REGISTRADA SEPARADAMENTE, e é o ponto inteiro desta função existir. Ela mora no mesmo
 * arquivo das rotas de distribuição por proximidade de domínio, mas fica do OUTRO LADO da
 * fronteira de autenticação — e proximidade de domínio foi exatamente o que a colocou no
 * lado errado.
 *
 * As rotas de distribuição são registradas ANTES do middleware de auth, com razão: quem as
 * consome é o cliente de um publisher, que não é membro de workspace algum. Esta rota lê o
 * Principal; registrada ali, ele **nunca** existe, e o resultado era um 404 permanente — sem
 * erro, sem log, apenas o publisher vendo o próprio pacote responder "não existe". Medido
 * contra o serviço no ar em 2026-08-01.
 *
 * Um consumidor NUNCA enxerga adoção — nem a do próprio bundle: saber quantos outros clientes
 * instalaram é informação do negócio do publisher, não dele.
 */
export interface AdoptionRoutesDeps {
  readonly adoptionFor: (workspaceId: string) => { adoption: (bundleId: string, since: Date) => Promise<unknown[]> };
}

export function registerAdoptionRoutes(app: Hono<AppEnv>, deps: AdoptionRoutesDeps): void {
  app.get('/v1/bundles/:bundleId/adoption', async (c) => {
    const principal = c.get('principal') as { workspaceId?: string } | undefined;
    if (principal?.workspaceId === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const dias = Number(c.req.query('days') ?? '30');
    const since = new Date(Date.now() - (Number.isFinite(dias) && dias > 0 ? dias : 30) * 86_400_000);
    const rows = await deps.adoptionFor(principal.workspaceId).adoption(c.req.param('bundleId'), since);
    return c.json({ bundle_id: c.req.param('bundleId'), since: since.toISOString(), adoption: rows }, 200);
  });
}
