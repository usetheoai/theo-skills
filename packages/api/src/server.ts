import { serve } from '@hono/node-server';
import { assertEmbeddingDim } from '@usetheo/skills';

import { createApp } from './server/app.js';
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
  const endpointsStore = createWebhookEndpointsStore(db);
  const embeddingsStore = createEmbeddingsStore(db);

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

  const app = createApp({ pool, queue, logger });
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

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'boot failed', err: message })}\n`);
  process.exit(1);
});
