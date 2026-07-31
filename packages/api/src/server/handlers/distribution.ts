import { type Hono } from 'hono';

import { type Db } from '../db.js';
import { type AppEnv } from '../principal-context.js';
import { type DistributionGrant, createDistributionResolver } from '../store/bundles-store.js';

/** Contador de quota por token — janela fixa em memória, como o rate limiter do M17. */
interface QuotaBucket {
  count: number;
  resetAt: number;
}

export interface DistributionRoutesDeps {
  readonly db: Db;
  /** Quota padrão por token, quando o token não declara a própria. */
  readonly defaultQuota: number;
  readonly windowMs: number;
  readonly now?: () => number;
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
