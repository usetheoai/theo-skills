import {
  type WebhookSendRequest,
  type WebhookSendResponse,
  type WebhookSender,
} from '@usetheo/skills';
import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';


import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { type Logger } from '../../src/server/logger.js';
import { createWebhookEndpointsStore } from '../../src/server/store/webhook-endpoints-store.js';
import {
  createWebhookDeliveryHandler,
  createWebhookDlqHandler,
  registerWebhookWorker,
} from '../../src/server/webhooks/webhook-delivery-worker.js';
import { createWebhookEnqueuer } from '../../src/server/webhooks/webhook-enqueuer.js';
import { createWebhookReconciler } from '../../src/server/webhooks/webhook-reconciler.js';
import { buildWorkerHandlers } from '../../src/server/wiring.js';
import { registerWorker } from '../../src/server/worker.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface LogLine {
  readonly level: 'info' | 'error';
  readonly fields: Record<string, unknown>;
  readonly msg: string;
}

/** A logger that records every line so the test can assert trace_id at each hop. */
function capturingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger: Logger = {
    info: (fields, msg) => { lines.push({ level: 'info', fields: { ...fields }, msg }); },
    error: (fields, msg) => { lines.push({ level: 'error', fields: { ...fields }, msg }); },
  };
  return { logger, lines };
}

class StubSender implements WebhookSender {
  readonly calls: WebhookSendRequest[] = [];
  send(req: WebhookSendRequest): Promise<WebhookSendResponse> {
    this.calls.push(req);
    return Promise.resolve({ status: 204 });
  }
}

const publicResolver = {
  resolve4: () => Promise.resolve(['93.184.216.34']),
  resolve6: () => Promise.resolve([] as string[]),
};

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error('condition not reached');
}

async function deliveryTraceId(skillId: string): Promise<string | undefined> {
  const r = await getPool().query<{ trace_id: string }>(
    `SELECT d.trace_id FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.payload->'data'->>'skill_id' = $1 LIMIT 1`,
    [skillId],
  );
  return r.rows[0]?.trace_id;
}

async function postSkillWithTrace(app: Hono, skillId: string, traceparent: string): Promise<string> {
  const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd(skillId) }]);
  const res = await app.request('/v1/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json', traceparent },
    body: JSON.stringify({ skill_id: skillId, zippedFilesystem: zip }),
  });
  return ((await res.json()) as { operation_id: string }).operation_id;
}

async function createEndpoint(app: Hono): Promise<void> {
  await app.request('/v1/webhookEndpoints', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://hooks.example.com/in', event_types: ['skill.created'] }),
  });
}

const KNOWN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const tp = (traceId: string): string => `00-${traceId}-0123456789abcdef-01`;

describeIntegration('trace_id propagation E2E (M9 T1.3 / gap #1)', () => {
  let boss: PgBoss;
  let app: Hono;
  let sender: StubSender;
  let cap: ReturnType<typeof capturingLogger>;

  beforeAll(async () => {
    boss = await startBoss();
    sender = new StubSender();
    cap = capturingLogger();
    const endpointsStore = createWebhookEndpointsStore(createDb(getPool()));
    const enqueuer = createWebhookEnqueuer({ endpointsStore, queue: boss, logger: cap.logger });
    const h = buildWorkerHandlers(getPool(), cap.logger, enqueuer);
    await registerWorker({ queue: boss, createHandler: h.createHandler, updateHandler: h.updateHandler, deleteHandler: h.deleteHandler });
    await registerWebhookWorker({
      queue: boss,
      deliveryHandler: createWebhookDeliveryHandler({ endpointsStore, sender, logger: cap.logger }),
      dlqHandler: createWebhookDlqHandler({ endpointsStore, logger: cap.logger }),
    });
    app = createApp({ pool: getPool(), queue: boss, logger: cap.logger, dnsResolver: publicResolver });
  });
  beforeEach(async () => {
    await truncateAll();
    sender.calls.length = 0;
    cap.lines.length = 0;
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('trace_id_flows_create_to_webhook', async () => {
    await createEndpoint(app);
    await postSkillWithTrace(app, 'tr-flow', tp(KNOWN));

    await waitFor(() => sender.calls.length >= 1);
    // The delivery ROW carries the trace id originated from the HTTP traceparent header (end-to-end).
    expect(await deliveryTraceId('tr-flow')).toEqual(KNOWN);

    // ... and the SAME trace id is logged at the enqueue hop AND the delivery hop.
    const enqueueLog = cap.lines.find((l) => l.msg.endsWith('enqueued') && l.fields['skill_id'] === 'tr-flow');
    const deliverLog = cap.lines.find((l) => l.msg === 'webhook delivered');
    expect(enqueueLog?.fields['trace_id']).toEqual(KNOWN);
    expect(deliverLog?.fields['trace_id']).toEqual(KNOWN);
  });

  it('concurrent_ingestions_distinct_trace_ids', async () => {
    await createEndpoint(app);
    const ids = ['00000000000000000000000000000a01', '00000000000000000000000000000b02', '00000000000000000000000000000c03'];
    await Promise.all(ids.map((tid, i) => postSkillWithTrace(app, `tr-cc-${i}`, tp(tid))));

    await waitFor(() => sender.calls.length >= 3);
    const seen = await Promise.all(ids.map((_, i) => deliveryTraceId(`tr-cc-${i}`)));
    expect(new Set(seen).size).toBe(3); // distinct trace ids — no cross-job leakage
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('reconciler_reenqueue_preserves_trace_id', async () => {
    // EC-1: an orphan delivery (row persisted, never enqueued) must keep its trace_id
    // when the reconciler re-drives it — proven by the delivery-worker log carrying it.
    const store = createWebhookEndpointsStore(createDb(getPool()));
    await store.create({ id: 'whe_tr', url: 'https://hooks.example.com/in', secret: 's', eventTypes: null });
    await store.recordDelivery({
      id: 'whd_tr',
      endpointId: 'whe_tr',
      eventType: 'skill.created',
      traceId: KNOWN,
      payload: { event_id: 'evt_x', event_type: 'skill.created', data: { skill_id: 'orphan', operation_id: 'op', state: 'ACTIVE', occurred_at: '2026-01-01T00:00:00Z' } },
    });
    await getPool().query("UPDATE webhook_deliveries SET create_time = now() - interval '5 minutes' WHERE id = 'whd_tr'");

    const reconciler = createWebhookReconciler({ endpointsStore: store, queue: boss, logger: cap.logger });
    expect(await reconciler.runOnce()).toBe(1);

    await waitFor(() => sender.calls.length >= 1);
    const deliverLog = cap.lines.find((l) => l.msg === 'webhook delivered' && l.fields['delivery_id'] === 'whd_tr');
    expect(deliverLog?.fields['trace_id']).toEqual(KNOWN); // trace survived the orphan re-enqueue
  });

  it('generated_trace_id_when_header_malformed', async () => {
    await createEndpoint(app);
    await postSkillWithTrace(app, 'tr-bad', 'garbage-header'); // EC-4
    await waitFor(() => sender.calls.length >= 1);
    const tid = await deliveryTraceId('tr-bad');
    expect(tid).toMatch(/^[0-9a-f]{32}$/); // generated, not the bad header
    expect(tid).not.toEqual('garbage-header');
  });
});
