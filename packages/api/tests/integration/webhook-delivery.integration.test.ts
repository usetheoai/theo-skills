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
import { createNoopLogger } from '../../src/server/logger.js';
import { createWebhookEndpointsStore } from '../../src/server/store/webhook-endpoints-store.js';
import {
  createWebhookDeliveryHandler,
  createWebhookDlqHandler,
  registerWebhookWorker,
} from '../../src/server/webhooks/webhook-delivery-worker.js';
import { createWebhookEnqueuer } from '../../src/server/webhooks/webhook-enqueuer.js';
import { createWebhookReconciler } from '../../src/server/webhooks/webhook-reconciler.js';
import { verifyWebhookSignature } from '../../src/server/webhooks/webhook-signing.js';
import { buildWorkerHandlers } from '../../src/server/wiring.js';
import { registerWorker } from '../../src/server/worker.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Programmable sender — records every request and answers per call index. */
class StubSender implements WebhookSender {
  readonly calls: WebhookSendRequest[] = [];
  responder: (callIndex: number) => number | 'throw' = () => 204;

  send(req: WebhookSendRequest): Promise<WebhookSendResponse> {
    const index = this.calls.length;
    this.calls.push(req);
    const r = this.responder(index);
    if (r === 'throw') {
      return Promise.reject(new Error('ECONNRESET'));
    }
    return Promise.resolve({ status: r });
  }
}

const publicResolver = {
  resolve4: () => Promise.resolve(['93.184.216.34']),
  resolve6: () => Promise.resolve([] as string[]),
};

async function pollOpState(app: Hono, opId: string, target: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const op = (await (await app.request(`/v1/operations/${opId}`)).json()) as { state: string };
    if (op.state === target || op.state === 'FAILED') return op.state;
    await sleep(50);
  }
  throw new Error('operation not terminal');
}

async function deliveryRow(id: string): Promise<{ delivered_at: Date | null; failed_at: Date | null } | undefined> {
  const r = await getPool().query<{ delivered_at: Date | null; failed_at: Date | null }>(
    'SELECT delivered_at, failed_at FROM webhook_deliveries WHERE id = $1',
    [id],
  );
  return r.rows[0];
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error('condition not reached');
}

async function createEndpoint(app: Hono, eventTypes?: string[]): Promise<{ id: string; secret: string }> {
  const body: Record<string, unknown> = { url: 'https://hooks.example.com/in' };
  if (eventTypes !== undefined) body['event_types'] = eventTypes;
  const res = await app.request('/v1/webhookEndpoints', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { id: string; secret: string };
}

async function postSkill(app: Hono, skillId: string): Promise<string> {
  const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd(skillId) }]);
  const res = await app.request('/v1/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_id: skillId, zippedFilesystem: zip }),
  });
  return ((await res.json()) as { operation_id: string }).operation_id;
}

describeIntegration('webhook delivery pipeline E2E (T5.1)', () => {
  let boss: PgBoss;
  let app: Hono;
  let sender: StubSender;

  beforeAll(async () => {
    boss = await startBoss();
    sender = new StubSender();
    const endpointsStore = createWebhookEndpointsStore(createDb(getPool()));
    const enqueuer = createWebhookEnqueuer({ endpointsStore, queue: boss, logger: createNoopLogger() });
    const h = buildWorkerHandlers(getPool(), createNoopLogger(), enqueuer);
    await registerWorker({ queue: boss, createHandler: h.createHandler, updateHandler: h.updateHandler, deleteHandler: h.deleteHandler });
    await registerWebhookWorker({
      queue: boss,
      deliveryHandler: createWebhookDeliveryHandler({ endpointsStore, sender, logger: createNoopLogger() }),
      dlqHandler: createWebhookDlqHandler({ endpointsStore, logger: createNoopLogger() }),
    });
  });
  beforeEach(async () => {
    await truncateAll();
    sender.calls.length = 0;
    sender.responder = () => 204;
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('delivers a signed webhook on skill.created (happy path)', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), dnsResolver: publicResolver });
    const ep = await createEndpoint(app, ['skill.created']);
    const opId = await postSkill(app, 'wh-ok');
    expect(await pollOpState(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await waitFor(() => sender.calls.length >= 1);
    const req = sender.calls[0];
    if (req === undefined) throw new Error('no send recorded');

    // signature verifies against the endpoint secret
    const sig = req.headers['webhook-signature'];
    if (sig === undefined) throw new Error('no signature header');
    const now = Math.floor(Date.now() / 1000);
    expect(verifyWebhookSignature(ep.secret, Buffer.from(req.body), sig, now)).toEqual({ valid: true });

    const payload = JSON.parse(req.body) as { event_type: string; data: { skill_id: string; state: string } };
    expect(payload.event_type).toBe('skill.created');
    expect(payload.data).toMatchObject({ skill_id: 'wh-ok', state: 'ACTIVE' });

    const did = req.headers['webhook-id'];
    if (did === undefined) throw new Error('no webhook-id');
    await waitFor(async () => (await deliveryRow(did))?.delivered_at !== null);
  });

  it('marks a 4xx response as a non-retriable failure (single attempt, no retry)', async () => {
    sender.responder = () => 400;
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), dnsResolver: publicResolver });
    await createEndpoint(app, ['skill.created']);
    const opId = await postSkill(app, 'wh-4xx');
    expect(await pollOpState(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await waitFor(() => sender.calls.length >= 1);
    const did = sender.calls[0]?.headers['webhook-id'];
    if (did === undefined) throw new Error('no webhook-id');
    await waitFor(async () => (await deliveryRow(did))?.failed_at !== null);

    // give pg-boss a beat — a non-retriable failure must NOT generate a second attempt.
    await sleep(500);
    expect(sender.calls.length).toBe(1);
  });

  it('retries on 5xx then delivers when the endpoint recovers', async () => {
    sender.responder = (i) => (i === 0 ? 503 : 204); // first attempt 5xx, then success
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), dnsResolver: publicResolver });
    await createEndpoint(app, ['skill.created']);
    const opId = await postSkill(app, 'wh-5xx');
    expect(await pollOpState(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await waitFor(() => sender.calls.length >= 2); // retried at least once
    const did = sender.calls[0]?.headers['webhook-id'];
    if (did === undefined) throw new Error('no webhook-id');
    await waitFor(async () => (await deliveryRow(did))?.delivered_at !== null);
  });

  it('reconciler recovers an orphaned (un-enqueued) delivery and it gets delivered', async () => {
    const endpointsStore = createWebhookEndpointsStore(createDb(getPool()));
    await endpointsStore.create({ id: 'whe_orphan', url: 'https://hooks.example.com/in', secret: 's', eventTypes: null });
    // simulate a crash AFTER recordDelivery but BEFORE enqueue: row exists, enqueued_at NULL.
    await endpointsStore.recordDelivery({
      id: 'whd_orphan',
      endpointId: 'whe_orphan',
      eventType: 'skill.created',
      traceId: 'tr-orphan',
      payload: { event_id: 'evt_x', event_type: 'skill.created', data: { skill_id: 's', operation_id: 'op', state: 'ACTIVE', occurred_at: '2026-01-01T00:00:00Z' } },
    });
    await getPool().query("UPDATE webhook_deliveries SET create_time = now() - interval '5 minutes' WHERE id = 'whd_orphan'");

    const reconciler = createWebhookReconciler({ endpointsStore, queue: boss, logger: createNoopLogger() });
    expect(await reconciler.runOnce()).toBe(1); // claimed + re-enqueued

    await waitFor(async () => (await deliveryRow('whd_orphan'))?.delivered_at !== null);
  });

  it('retries on a transient network error then delivers', async () => {
    sender.responder = (i) => (i === 0 ? 'throw' : 204); // first attempt errors, then succeeds
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), dnsResolver: publicResolver });
    await createEndpoint(app, ['skill.created']);
    const opId = await postSkill(app, 'wh-neterr');
    expect(await pollOpState(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await waitFor(() => sender.calls.length >= 2); // retried after the network error
    const did = sender.calls[0]?.headers['webhook-id'];
    if (did === undefined) throw new Error('no webhook-id');
    await waitFor(async () => (await deliveryRow(did))?.delivered_at !== null);
  });

  it('does NOT deliver to an endpoint whose event-type filter excludes the event', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), dnsResolver: publicResolver });
    await createEndpoint(app, ['skill.deleted']); // subscribed only to deletes
    const opId = await postSkill(app, 'wh-filtered'); // emits skill.created
    expect(await pollOpState(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await sleep(800); // give any erroneous fan-out time to fire
    expect(sender.calls.length).toBe(0); // filtered out — no delivery
  });

  it('two concurrent reconciler sweeps re-drive an orphan exactly once (no double send)', async () => {
    const endpointsStore = createWebhookEndpointsStore(createDb(getPool()));
    await endpointsStore.create({ id: 'whe_2rec', url: 'https://hooks.example.com/in', secret: 's', eventTypes: null });
    await endpointsStore.recordDelivery({ id: 'whd_2rec', endpointId: 'whe_2rec', eventType: 'skill.created', traceId: 'tr-test', payload: { k: 1 } });
    await getPool().query("UPDATE webhook_deliveries SET create_time = now() - interval '5 minutes' WHERE id = 'whd_2rec'");

    const reconciler = createWebhookReconciler({ endpointsStore, queue: boss, logger: createNoopLogger() });
    const [a, b] = await Promise.all([reconciler.runOnce(), reconciler.runOnce()]);
    expect(a + b).toBe(1); // claimed by exactly one sweep — no double-claim

    await waitFor(async () => (await deliveryRow('whd_2rec'))?.delivered_at !== null);
    const sends = sender.calls.filter((c) => c.headers['webhook-id'] === 'whd_2rec');
    expect(sends.length).toBe(1); // delivered exactly once
  });

  it('reconciler re-drives a STUCK (enqueued but non-terminal) delivery (lost DLQ event)', async () => {
    const endpointsStore = createWebhookEndpointsStore(createDb(getPool()));
    await endpointsStore.create({ id: 'whe_stuck', url: 'https://hooks.example.com/in', secret: 's', eventTypes: null });
    await endpointsStore.recordDelivery({ id: 'whd_stuck', endpointId: 'whe_stuck', eventType: 'skill.created', traceId: 'tr-test', payload: { k: 1 } });
    await endpointsStore.stampEnqueued('whd_stuck'); // enqueued...
    // ...but the job vanished without a terminal stamp; age it past the stuck window.
    await getPool().query("UPDATE webhook_deliveries SET enqueued_at = now() - interval '20 minutes' WHERE id = 'whd_stuck'");

    const reconciler = createWebhookReconciler({ endpointsStore, queue: boss, logger: createNoopLogger(), stuckGraceMs: 600_000 });
    expect(await reconciler.runOnce()).toBe(1); // re-driven via the stuck sweep
    await waitFor(async () => (await deliveryRow('whd_stuck'))?.delivered_at !== null);
  });
});
