import { type AuthVerifier } from '@usetheo/skills';
import {
  DEFAULT_PRINCIPAL,
  type EmbeddingProvider,
  type PayloadValidator,
  type Principal,
  type SecretScanner,
} from '@usetheo/skills';
import { createSecretlintScanner } from '@usetheo/skills/validators';
import { createYauzlPayloadValidator } from '@usetheo/skills/validators';
import { Hono, type Context } from 'hono';
import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';

import { createAuthMiddleware } from './auth/middleware.js';
import { createDb } from './db.js';
import { registerAdminKeysRoutes } from './handlers/admin-keys.js';
import { registerAdoptionRoutes, registerDistributionRoutes } from './handlers/distribution.js';
import { registerHealthRoutes } from './handlers/health.js';
import { registerMembersRoutes } from './handlers/members.js';
import { registerOperationsRoutes } from './handlers/operations.js';
import { registerPlatformKeysRoutes } from './handlers/platform-keys.js';
import { registerPublishingRoutes } from './handlers/publishing.js';
import { registerRetrieveRoutes } from './handlers/retrieve.js';
import { registerSkillsRoutes } from './handlers/skills.js';
import { registerVersionRoutes } from './handlers/version.js';
import { registerVisibilityRoutes } from './handlers/visibility.js';
import { registerWebhookEndpointRoutes } from './handlers/webhook-endpoints.js';
import { createJsonLogger, type Logger } from './logger.js';
import { createRateLimiter, type RateLimitConfig } from './middleware/rate-limit.js';
import { createObservabilityMiddleware, MetricsRegistry } from './observability/metrics.js';
import { type AppEnv } from './principal-context.js';
import { selectEmbedder } from './providers/embedder-selection.js';
import { createDispatchingRetriever } from './providers/retriever-selection.js';
import { createPgExecutor } from './retrieve/pg-executor.js';
import { createAdoptionStore } from './store/adoption-store.js';
import { createBundlesStore } from './store/bundles-store.js';
import { createChannelsStore } from './store/channels-store.js';
import { createMembersStore } from './store/members-store.js';
import { createOperationsStore } from './store/operations-store.js';
import { createRevisionsStore } from './store/revisions-store.js';
import { createSkillsStore } from './store/skills-store.js';
import { createWebhookEndpointsStore } from './store/webhook-endpoints-store.js';
import { type DnsResolver } from './webhooks/url-safety.js';

const DEFAULT_RESERVATION_HOURS = 24;
const DEFAULT_MAX_BODY_BYTES = 35 * 1024 * 1024; // ~25MB zip after base64 envelope

export interface CreateAppOptions {
  readonly pool: Pool;
  readonly queue: PgBoss;
  readonly logger?: Logger;
  readonly payloadValidator?: PayloadValidator;
  readonly secretScanner?: SecretScanner;
  readonly reservationHours?: number;
  readonly maxBodyBytes?: number;
  /** Injectable DNS resolver for the webhook SSRF guard (tests stub this). */
  readonly dnsResolver?: DnsResolver;
  /** Embedder for the retrieve endpoint (defaults to env-selected). */
  readonly embedder?: EmbeddingProvider;
  /**
   * Resolve QUEM esta chamando — o inquilino e suas capacidades (M11).
   *
   * PORTA, e nao cabecalho, DE PROPOSITO (ADR-M11-2). Aceitar um `x-workspace-id` tornaria o
   * isolamento falsificavel por qualquer cliente: bastaria trocar o cabecalho para ler o
   * catalogo alheio. Enquanto a autenticacao real nao existe (M12), o default resolve para
   * o workspace `default` — a ponte legada, que mantem a instalacao single-tenant intacta.
   *
   * Os testes injetam resolvers distintos para provar isolamento SEM abrir essa porta.
   */
  readonly principalResolver?: (c: Context<AppEnv>) => Principal;
  /**
   * Verificador de credencial (M12). Quando presente, o middleware de auth substitui o
   * `principalResolver` e passa a governar a fronteira: `401` sem credencial válida,
   * `403` com scope insuficiente, `503` quando o backend cai.
   *
   * Ausente = BRIDGE LEGADO: toda requisição colapsa no workspace `default`. É o estado
   * de hoje, preservado de propósito para o M12 entrar sem quebrar quem já consome a API
   * — e o `SECURITY.md` continua declarando que o serviço não deve ser exposto assim.
   */
  readonly authVerifier?: AuthVerifier;
  /**
   * Rate limit por principal (M17). Ausente = desligado — de propósito: um limite ativado
   * por omissão, com número escolhido no escuro, derruba cliente legítimo, que é o risco #2
   * declarado do milestone. Ligar é decisão de operação, com o número vindo de medição.
   */
  readonly rateLimit?: RateLimitConfig;
  /** Quota das rotas de distribuição (M20). Ausente = distribuição desligada. */
  readonly distribution?: { readonly defaultQuota: number; readonly windowMs: number };
  /**
   * Registro de métricas (M17). Injetável para que o operador — e os testes — leiam os
   * agregados sem depender de um backend externo. Ausente = um registro interno é criado.
   */
  readonly metrics?: MetricsRegistry;
  /**
   * Credencial de PLATAFORMA (M22). Ausente = a rota de cunhagem não é registrada.
   *
   * Fail-closed de propósito: um serviço que expõe provisionamento por omissão é pior que um
   * que não o expõe — o operador acredita que está desligado. Ela vive só no control plane.
   */
  readonly platformAdminKey?: string;
}

/** Build the Hono app with injected dependencies (DIP, ADR-3). */
export function createApp(opts: CreateAppOptions): Hono<AppEnv> {
  const db = createDb(opts.pool);
  const logger = opts.logger ?? createJsonLogger();

  const app = new Hono<AppEnv>();

  // PRIMEIRO middleware de todos: a latência medida precisa incluir tudo o que vem depois —
  // auth, rate limit, handler. Instrumentar depois do auth mediria só o trecho barato e
  // esconderia justamente a lentidão que importa investigar.
  const metrics = opts.metrics ?? new MetricsRegistry();
  app.use('*', createObservabilityMiddleware({ registry: metrics, logger: opts.logger ?? createJsonLogger() }));

  app.onError((err, c) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  // ROTAS PÚBLICAS — registradas ANTES do middleware de auth de propósito.
  //
  // No Hono um middleware só alcança as rotas registradas DEPOIS dele, então a ordem aqui
  // É o mecanismo, não convenção. `/v1/health` e `/v1/version` ficam abertos porque atrás
  // de credencial "o serviço caiu" e "minha credencial está errada" produzem a mesma
  // resposta, e quem monitora não consegue separar os dois. O painel /status do TheoCloud e
  // o reconciliador do dev host leem exatamente `/v1/version` sem credencial alguma —
  // fechá-los quebraria a observabilidade da frota inteira, e foi o que um teste de wiring
  // pegou antes de virar incidente.
  registerHealthRoutes(app);
  registerVersionRoutes(app);

  // DISTRIBUIÇÃO — registrada aqui, ANTES do middleware de autenticação interna, porque quem
  // a consome é o cliente de um publisher: não é membro de workspace algum e não tem
  // Principal. Passá-la pelo auth interno exigiria um caminho de exceção lá dentro, e um
  // caminho de exceção é o que se esquece de fechar.
  if (opts.distribution !== undefined) {
    registerDistributionRoutes(app, {
      db,
      defaultQuota: opts.distribution.defaultQuota,
      windowMs: opts.distribution.windowMs,
      recordInstall: (e) => createAdoptionStore(db, e.workspaceId).record(e),
      resolveChannel: async (ws, skillId, channel) => {
        const canais = createChannelsStore(db, ws);
        const alvo = await canais.get(skillId, channel);
        if (alvo === null) return null;
        const versoes = await canais.versionsOf(skillId);
        return {
          revisionId: alvo.revisionId,
          version: versoes.find((v) => v.revisionId === alvo.revisionId)?.version ?? null,
        };
      },
    });
  }

  // O Principal e resolvido UMA vez por requisicao e carregado no contexto; os stores sao
  // construidos JA ESCOPADOS a ele. Nenhum handler recebe um store global.
  // Com verificador, a fronteira é o middleware de auth — ele resolve o Principal a partir
  // da CREDENCIAL, que é a única origem admissível do tenant (M11 DoD #1 + M12 DoD #3).
  // A cunhagem de plataforma é registrada ANTES do middleware de auth: ela tem credencial
  // PRÓPRIA (control plane), e submetê-la ao verificador de chave de usuário a tornaria
  // alcançável por credencial de caminho de dados — o oposto da separação que ela existe para
  // manter. Ausente a credencial, a rota não é registrada e responde 404.
  if (opts.platformAdminKey !== undefined && opts.platformAdminKey !== '') {
    registerPlatformKeysRoutes(app, {
      db,
      logger: opts.logger ?? createJsonLogger(),
      platformAdminKey: opts.platformAdminKey,
    });
  }

  if (opts.authVerifier !== undefined) {
    app.use('*', createAuthMiddleware({ verifier: opts.authVerifier, authRequired: true }));
  }

  const resolvePrincipal = opts.principalResolver ?? ((): Principal => DEFAULT_PRINCIPAL);
  app.use('*', async (c, next) => {
    // Já autenticado pelo middleware acima: não sobrescrever o Principal da credencial.
    if (opts.authVerifier !== undefined) {
      await next();
      return;
    }
    // O middleware `*` do Hono entrega um Context com path genérico; o resolver declara o
    // Context tipado do app. São o mesmo objeto em runtime — o estreitamento explícito evita
    // que a diferença de assinatura vire `any` implícito.
    c.set('principal', resolvePrincipal(c as unknown as Context<AppEnv>));
    await next();
  });

  // Rate limit DEPOIS de o principal existir — nos DOIS caminhos (com e sem verificador).
  //
  // A primeira versão deste wiring o colocou logo após o middleware de auth, e estava errada:
  // sem `authVerifier` o principal só é setado no middleware seguinte, então o limiter leria
  // `undefined` e quebraria justamente a configuração legada que ele deveria proteger.
  //
  // O orçamento é POR PRINCIPAL e não por IP: num registry multi-tenant o IP é o gateway do
  // cliente, então limitar por IP puniria todos os usuários dele pelo excesso de um só — e
  // não conteria nada quando o abuso vem de IPs distintos com a mesma credencial.
  if (opts.rateLimit !== undefined) {
    app.use('*', createRateLimiter({ config: opts.rateLimit }));
  }

  // Rotas de PUBLICAÇÃO (M27) — canais e bundles. Depois do middleware de auth, porque o
  // ator é um publisher autenticado, e sob escopo `skills:publish`: mover um canal aponta
  // todos os consumidores para outro conteúdo, e cunhar credencial de bundle dá acesso ao
  // catálogo a um terceiro. Nenhuma das duas é escrita comum.
  // ADOÇÃO — atrás da autenticação, ao contrário da distribuição logo acima. Quem lê é o
  // publisher autenticado; registrada junto da distribuição (como estava), o Principal ainda
  // não foi resolvido e a rota respondia 404 para sempre.
  if (opts.distribution !== undefined) {
    registerAdoptionRoutes(app, { adoptionFor: (ws: string) => createAdoptionStore(db, ws) });
  }

  registerPublishingRoutes(app, {
    channelsStoreFor: (ws) => createChannelsStore(db, ws),
    bundlesStoreFor: (ws) => createBundlesStore(db, ws),
    skillsStoreFor: (ws) => createSkillsStore(db, ws),
  });

  registerSkillsRoutes(app, {
    skillsStoreFor: (ws: string) => createSkillsStore(db, ws),
    revisionsStoreFor: (ws: string) => createRevisionsStore(db, ws),
    operationsStoreFor: (ws: string) => createOperationsStore(db, ws),
    queue: opts.queue,
    payloadValidator: opts.payloadValidator ?? createYauzlPayloadValidator(),
    secretScanner: opts.secretScanner ?? createSecretlintScanner(),
    logger,
    reservationHours: opts.reservationHours ?? envReservationHours(),
    maxBodyBytes: opts.maxBodyBytes ?? envMaxBodyBytes(),
  });
  registerOperationsRoutes(app, { operationsStoreFor: (ws: string) => createOperationsStore(db, ws) });
  registerMembersRoutes(app, { membersStoreFor: (ws: string) => createMembersStore(db, ws) });
  registerAdminKeysRoutes(app, { db, membersStoreFor: (ws: string) => createMembersStore(db, ws) });
  registerVisibilityRoutes(app, { db, membersStoreFor: (ws: string) => createMembersStore(db, ws) });
  registerWebhookEndpointRoutes(app, {
    endpointsStoreFor: (ws: string) => createWebhookEndpointsStore(db, ws),
    logger,
    ...(opts.dnsResolver !== undefined ? { dnsResolver: opts.dnsResolver } : {}),
  });
  // Retriever POR WORKSPACE, como os stores acima — não um singleton de boot.
  //
  // O executor e o embedder continuam sendo criados uma vez (são caros e sem estado de
  // tenant); o que se cria por requisição é o closure que fixa o workspace. Montar o
  // dispatcher uma única vez no boot foi exatamente o que deixou a rota de descoberta
  // servindo o catálogo inteiro a qualquer tenant.
  const retrieveExecutor = createPgExecutor(opts.pool);
  const retrieveEmbedder = opts.embedder ?? selectEmbedder();
  registerRetrieveRoutes(app, {
    retrieverFor: (ws: string) =>
      createDispatchingRetriever({ executor: retrieveExecutor, embedder: retrieveEmbedder, workspaceId: ws }),
    logger,
  });

  return app;
}

function envReservationHours(): number {
  const raw = Number(process.env['THEOSKILL_ID_RESERVATION_HOURS'] ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESERVATION_HOURS;
}

function envMaxBodyBytes(): number {
  const raw = Number(process.env['THEOSKILL_MAX_BODY_BYTES'] ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BODY_BYTES;
}
