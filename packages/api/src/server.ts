import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { assertEmbeddingDim, DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { runMigrations } from '@usetheo/skills/migrate';

import { createApp } from './server/app.js';
import { createApiKeyVerifier } from './server/auth/api-key-verifier.js';
import { createApiKeysStore } from './server/store/api-keys-store.js';
import { createDb, createPool } from './server/db.js';
import {
  createEmbedEnqueuer,
  createEmbedSkillHandler,
  registerEmbedWorker,
} from './server/embed/embed-worker.js';
import { createJsonLogger } from './server/logger.js';
import { selectEmbedder } from './server/providers/embedder-selection.js';
import { setupGracefulDrain } from './server/queue/graceful-drain.js';
import {
  createQueue,
  EMBED_SKILL_DLQ_QUEUE_NAME,
  JOB_NAMES,
  WEBHOOK_DELIVERY_DLQ_QUEUE_NAME,
} from './server/queue/queue.js';
import { createEmbeddingsStore } from './server/store/embeddings-store.js';
import { createWebhookEndpointsStore } from './server/store/webhook-endpoints-store.js';
import {
  createWebhookDeliveryHandler,
  createWebhookDlqHandler,
  registerWebhookWorker,
} from './server/webhooks/webhook-delivery-worker.js';
import { createWebhookEnqueuer } from './server/webhooks/webhook-enqueuer.js';
import { createWebhookReconciler, startWebhookReconciler } from './server/webhooks/webhook-reconciler.js';
import { createHttpWebhookSender } from './server/webhooks/webhook-sender.js';
import { buildWorkerHandlers } from './server/wiring.js';
import { composeTerminalHooks, registerWorker } from './server/worker.js';

/**
 * Traduz o AMBIENTE nas opções de composição do app (M12 / M17 / M20).
 *
 * Pura e exportada de propósito. Enquanto esta decisão vivia embutida em `main()`, a única
 * forma de verificar a composição de PRODUÇÃO era subir o processo — e ninguém subia: os
 * testes montavam `createApp` com as opções à mão e provavam um sistema que o binário não
 * era. Foi assim que auth, rate limit e distribuição ficaram escritos, testados e desligados,
 * com `GET /v1/skills` respondendo 200 sem credencial no serviço implantado.
 *
 * Separar DECISÃO (esta função) de EFEITO (`main`) é o que torna o gate verificável.
 */
export interface EnvAppOptions {
  readonly authRequired: boolean;
  readonly rateLimit?: { readonly read: number; readonly write: number; readonly windowMs: number };
  readonly distribution?: { readonly defaultQuota: number; readonly windowMs: number };
}

export function resolveAppOptionsFromEnv(env: Record<string, string | undefined>): EnvAppOptions {
  // Exigir credencial é decisão de OPERAÇÃO, não default de código: ligar por omissão
  // devolveria 401 a todo chamador já integrado no deploy seguinte, sem aviso. Mesmo padrão
  // do theo-memory (`parseRequireCredentialEnv`).
  const authRequired = ['true', '1'].includes((env['THEOSKILL_AUTH_REQUIRED'] ?? '').trim().toLowerCase());

  // Os DOIS limites são obrigatórios juntos: ligar só um deixa a outra classe de rota sem
  // teto, e meia proteção é pior que nenhuma — passa a impressão de um guard que não existe.
  const read = Number(env['THEOSKILL_RATE_LIMIT_READ'] ?? '0');
  const write = Number(env['THEOSKILL_RATE_LIMIT_WRITE'] ?? '0');
  const limitesValidos = Number.isFinite(read) && Number.isFinite(write) && read > 0 && write > 0;
  const rateLimit = limitesValidos
    ? { read, write, windowMs: Number(env['THEOSKILL_RATE_LIMIT_WINDOW_MS'] ?? '60000') }
    : undefined;

  const quota = Number(env['THEOSKILL_DISTRIBUTION_QUOTA'] ?? '0');
  const distribution =
    Number.isFinite(quota) && quota > 0
      ? { defaultQuota: quota, windowMs: Number(env['THEOSKILL_DISTRIBUTION_WINDOW_MS'] ?? '60000') }
      : undefined;

  return {
    authRequired,
    ...(rateLimit !== undefined ? { rateLimit } : {}),
    ...(distribution !== undefined ? { distribution } : {}),
  };
}

const SHUTDOWN_DEADLINE_MS = 30_000;
const RECONCILER_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const logger = createJsonLogger();
  const uri = process.env['THEOSKILL_PG_URI'];
  if (uri === undefined || uri === '') {
    logger.error({}, 'THEOSKILL_PG_URI is required — refusing to start');
    process.exit(1);
    return;
  }
  const port = Number(process.env['PORT'] ?? '8080');

  const pool = createPool(uri);
  const queue = createQueue(uri);

  // O schema da APLICAÇÃO vem antes de tudo — a imagem é autossuficiente.
  //
  // Sem este passo o serviço subia com ZERO tabelas contra um banco novo: `/v1/health`
  // devolvia 200 (ele é estático de propósito — liveness dependente do banco deixaria uma
  // queda de 30 s matar o container) enquanto `/v1/skills` devolvia 500. Um serviço
  // "saudável" servindo erro em tudo é pior que um fora do ar: o painel o conta como frota
  // completa. Observado no dev host em 2026-07-30, no primeiro deploy real.
  //
  // Vem ANTES de `queue.start()` pela mesma razão que ele vem antes de `serve()`: quem
  // depende do schema não pode correr antes de o schema existir. `runMigrations` serializa
  // réplicas concorrentes com advisory lock — migrar no boot é seguro com N réplicas.
  await runMigrations(pool);
  logger.info({}, 'schema aplicado');

  // pg-boss MUST start before serve() — bootstraps its schema (pg-boss v10).
  await queue.start();
  await queue.createQueue(JOB_NAMES.CREATE_SKILL);
  await queue.createQueue(JOB_NAMES.UPDATE_SKILL);
  await queue.createQueue(JOB_NAMES.DELETE_SKILL);
  await queue.createQueue(JOB_NAMES.WEBHOOK_DELIVERY);
  await queue.createQueue(WEBHOOK_DELIVERY_DLQ_QUEUE_NAME);
  await queue.createQueue(JOB_NAMES.EMBED_SKILL);
  await queue.createQueue(EMBED_SKILL_DLQ_QUEUE_NAME);

  const db = createDb(pool);
  const endpointsStore = createWebhookEndpointsStore(db, DEFAULT_WORKSPACE_ID);
  const embeddingsStore = createEmbeddingsStore(db, DEFAULT_WORKSPACE_ID);

  // Select the embedding provider. Probe the dimension at boot ONLY for the
  // deterministic stub (free, instant). For network providers a live boot probe
  // would couple HTTP-API liveness to the embeddings API and spend a call on every
  // restart — the per-embedding guard in the embed worker enforces the dimension
  // there instead (fail-fast without crashlooping the whole server).
  const embedder = selectEmbedder();
  if (embedder.provider === 'stub') {
    assertEmbeddingDim(await embedder.embed('boot dimension probe'));
  }
  logger.info({ provider: embedder.provider, model: embedder.model }, 'embedder selected');

  // onTerminal composes the webhook fan-out + the embed enqueue (ACTIVE only).
  const webhookEnqueuer = createWebhookEnqueuer({ endpointsStore, queue, logger });
  const embedEnqueuer = createEmbedEnqueuer({ queue, embeddingsStore, logger });
  const handlers = buildWorkerHandlers(pool, logger, composeTerminalHooks(webhookEnqueuer, embedEnqueuer));
  await registerWorker({
    queue,
    createHandler: handlers.createHandler,
    updateHandler: handlers.updateHandler,
    deleteHandler: handlers.deleteHandler,
  });

  // Embed worker — generates + indexes the vector for the skill's current revision.
  await registerEmbedWorker({
    queue,
    handler: createEmbedSkillHandler({ embeddingsStore, embedder, logger }),
    logger,
  });

  // Webhook delivery worker + dead-letter consumer (SSRF-safe pinned egress).
  const sender = createHttpWebhookSender();
  await registerWebhookWorker({
    queue,
    deliveryHandler: createWebhookDeliveryHandler({ endpointsStore, sender, logger }),
    dlqHandler: createWebhookDlqHandler({ endpointsStore, logger }),
  });

  // Reconciler — periodically recovers orphaned (un-enqueued) deliveries.
  const reconciler = createWebhookReconciler({ endpointsStore, queue, logger });
  const stopReconciler = startWebhookReconciler(reconciler, RECONCILER_INTERVAL_MS, logger);

  // COMPOSITION ROOT — auth, rate limit e distribuição são OPCIONAIS em `createApp` e só
  // montam quando passados. Nenhum era: quatro milestones escritos, testados e inalcançáveis.
  const envOpts = resolveAppOptionsFromEnv(process.env);
  const authVerifier = envOpts.authRequired ? createApiKeyVerifier(createApiKeysStore(db)) : undefined;
  logger.info(
    {
      auth_required: envOpts.authRequired,
      rate_limit: envOpts.rateLimit !== undefined,
      distribution: envOpts.distribution !== undefined,
    },
    envOpts.authRequired
      ? 'auth ATIVA — credencial obrigatória em toda rota exceto /v1/health e /v1/version'
      : 'auth DESLIGADA (THEOSKILL_AUTH_REQUIRED != true) — o serviço não deve ser exposto assim',
  );

  const app = createApp({
    pool,
    queue,
    logger,
    ...(authVerifier !== undefined ? { authVerifier } : {}),
    ...(envOpts.rateLimit !== undefined ? { rateLimit: envOpts.rateLimit } : {}),
    ...(envOpts.distribution !== undefined ? { distribution: envOpts.distribution } : {}),
  });
  const server = serve({ fetch: app.fetch, port }, (info) => {
    logger.info({ port: info.port }, '@usetheo/skills-api listening');
  });

  // Drain order is non-negotiable: server.close → reconciler → queue.stop → pool.end.
  setupGracefulDrain({
    drainables: [
      () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
      () => { stopReconciler(); return Promise.resolve(); },
      async () => { await queue.stop(); },
      async () => { await pool.end(); },
    ],
    timeoutMs: SHUTDOWN_DEADLINE_MS,
    logger,
  });
}

/**
 * Só sobe o servidor quando ESTE módulo é o entrypoint.
 *
 * Sem a guarda, um `import` deste arquivo executava `main()` — e como ele exige
 * `THEOSKILL_PG_URI`, qualquer teste que quisesse verificar a COMPOSIÇÃO derrubava o
 * processo com `process.exit(1)`. Era mais uma razão pela qual ninguém testava o composition
 * root: o módulo não podia ser importado. Separar decisão de efeito exige que o efeito não
 * aconteça só por alguém olhar.
 */
const ehEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ehEntrypoint) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'boot failed', err: message })}\n`);
    process.exit(1);
  });
}
