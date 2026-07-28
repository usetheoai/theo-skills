import { type EmbeddingProvider, type PayloadValidator, type SecretScanner } from '@usetheo/skills';
import { Hono } from 'hono';
import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';

import { createDb } from './db.js';
import { registerHealthRoutes } from './handlers/health.js';
import { registerOperationsRoutes } from './handlers/operations.js';
import { registerRetrieveRoutes } from './handlers/retrieve.js';
import { registerSkillsRoutes } from './handlers/skills.js';
import { registerWebhookEndpointRoutes } from './handlers/webhook-endpoints.js';
import { createJsonLogger, type Logger } from './logger.js';
import { createSecretlintScanner } from './payload/secretlint-scanner.js';
import { createYauzlPayloadValidator } from './payload/yauzl-validator.js';
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
}

/** Build the Hono app with injected dependencies (DIP, ADR-3). */
export function createApp(opts: CreateAppOptions): Hono {
  const db = createDb(opts.pool);
  const logger = opts.logger ?? createJsonLogger();

  const app = new Hono();
  app.onError((err, c) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  registerHealthRoutes(app);
  registerSkillsRoutes(app, {
    skillsStore: createSkillsStore(db),
    revisionsStore: createRevisionsStore(db),
    operationsStore: createOperationsStore(db),
    queue: opts.queue,
    payloadValidator: opts.payloadValidator ?? createYauzlPayloadValidator(),
    secretScanner: opts.secretScanner ?? createSecretlintScanner(),
    logger,
    reservationHours: opts.reservationHours ?? envReservationHours(),
    maxBodyBytes: opts.maxBodyBytes ?? envMaxBodyBytes(),
  });
  registerOperationsRoutes(app, { operationsStore: createOperationsStore(db) });
  registerWebhookEndpointRoutes(app, {
    endpointsStore: createWebhookEndpointsStore(db),
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
