import {
  DEFAULT_PRINCIPAL,
  type EmbeddingProvider,
  type PayloadValidator,
  type Principal,
  type SecretScanner,
} from '@usetheo/skills';
import { Hono, type Context } from 'hono';
import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';

import { createDb } from './db.js';
import { registerHealthRoutes } from './handlers/health.js';
import { registerOperationsRoutes } from './handlers/operations.js';
import { registerRetrieveRoutes } from './handlers/retrieve.js';
import { registerSkillsRoutes } from './handlers/skills.js';
import { registerVersionRoutes } from './handlers/version.js';
import { registerWebhookEndpointRoutes } from './handlers/webhook-endpoints.js';
import { createJsonLogger, type Logger } from './logger.js';
import { createSecretlintScanner } from './payload/secretlint-scanner.js';
import { createYauzlPayloadValidator } from './payload/yauzl-validator.js';
import { type AppEnv } from './principal-context.js';
import { selectEmbedder } from './providers/embedder-selection.js';
import { createDispatchingRetriever } from './providers/retriever-selection.js';
import { createPgExecutor } from './retrieve/pg-executor.js';
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
}

/** Build the Hono app with injected dependencies (DIP, ADR-3). */
export function createApp(opts: CreateAppOptions): Hono<AppEnv> {
  const db = createDb(opts.pool);
  const logger = opts.logger ?? createJsonLogger();

  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  // O Principal e resolvido UMA vez por requisicao e carregado no contexto; os stores sao
  // construidos JA ESCOPADOS a ele. Nenhum handler recebe um store global.
  const resolvePrincipal = opts.principalResolver ?? ((): Principal => DEFAULT_PRINCIPAL);
  app.use('*', async (c, next) => {
    // O middleware `*` do Hono entrega um Context com path genérico; o resolver declara o
    // Context tipado do app. São o mesmo objeto em runtime — o estreitamento explícito evita
    // que a diferença de assinatura vire `any` implícito.
    c.set('principal', resolvePrincipal(c as unknown as Context<AppEnv>));
    await next();
  });

  registerHealthRoutes(app);
  registerVersionRoutes(app);
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
  registerWebhookEndpointRoutes(app, {
    endpointsStoreFor: (ws: string) => createWebhookEndpointsStore(db, ws),
    logger,
    ...(opts.dnsResolver !== undefined ? { dnsResolver: opts.dnsResolver } : {}),
  });
  registerRetrieveRoutes(app, {
    retriever: createDispatchingRetriever({
      executor: createPgExecutor(opts.pool),
      embedder: opts.embedder ?? selectEmbedder(),
    }),
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
