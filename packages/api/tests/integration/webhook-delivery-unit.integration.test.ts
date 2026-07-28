import { type WebhookSendResponse, type WebhookSender } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createWebhookEndpointsStore } from '../../src/server/store/webhook-endpoints-store.js';
import {
  createWebhookDeliveryHandler,
  createWebhookDlqHandler,
} from '../../src/server/webhooks/webhook-delivery-worker.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const okSender: WebhookSender = { send: () => Promise.resolve({ status: 204 }) };
class CountingSender implements WebhookSender {
  calls = 0;
  status = 204;
  send(): Promise<WebhookSendResponse> {
    this.calls += 1;
    return Promise.resolve({ status: this.status });
  }
}

const store = () => createWebhookEndpointsStore(createDb(getPool()));

async function seedDelivery(id: string, opts: { active?: boolean; enqueue?: boolean } = {}): Promise<void> {
  const s = store();
  await s.create({ id: `whe_${id}`, url: 'https://hooks.example.com/in', secret: 'sek', eventTypes: null });
  if (opts.active === false) {
    await getPool().query('UPDATE webhook_endpoints SET active = false WHERE id = $1', [`whe_${id}`]);
  }
  await s.recordDelivery({ id: `whd_${id}`, endpointId: `whe_${id}`, eventType: 'skill.created', traceId: 'tr-test', payload: { x: 1 } });
  if (opts.enqueue === true) {
    await s.stampEnqueued(`whd_${id}`);
  }
}

describeIntegration('webhook delivery handler edges + DLQ + stuck + concurrent claim', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('DLQ handler marks the delivery failed (retries exhausted)', async () => {
    await seedDelivery('dlq', { enqueue: true });
    const handler = createWebhookDlqHandler({ endpointsStore: store(), logger: createNoopLogger() });
    await handler({ delivery_id: 'whd_dlq', endpoint_id: 'whe_dlq', trace_id: 'tr-test', payload: {} });
    const row = await store().getDeliveryById('whd_dlq');
    expect(row?.failedAt).not.toBeNull();
  });

  it('delivery handler is a no-op when the delivery row is gone', async () => {
    const sender = new CountingSender();
    const handler = createWebhookDeliveryHandler({ endpointsStore: store(), sender, logger: createNoopLogger() });
    await handler({ delivery_id: 'whd_missing', endpoint_id: 'whe_missing', trace_id: 'tr-test', payload: {} });
    expect(sender.calls).toBe(0); // never attempted a send
  });

  it('delivery handler marks failed (no send) when the endpoint is inactive', async () => {
    await seedDelivery('inactive', { active: false });
    const sender = new CountingSender();
    const handler = createWebhookDeliveryHandler({ endpointsStore: store(), sender, logger: createNoopLogger() });
    await handler({ delivery_id: 'whd_inactive', endpoint_id: 'whe_inactive', trace_id: 'tr-test', payload: {} });
    expect(sender.calls).toBe(0);
    expect((await store().getDeliveryById('whd_inactive'))?.failedAt).not.toBeNull();
  });

  it('delivery handler delivers a healthy endpoint (terminal idempotent on re-run)', async () => {
    await seedDelivery('ok', { enqueue: true });
    const handler = createWebhookDeliveryHandler({ endpointsStore: store(), sender: okSender, logger: createNoopLogger() });
    await handler({ delivery_id: 'whd_ok', endpoint_id: 'whe_ok', trace_id: 'tr-test', payload: {} });
    const first = await store().getDeliveryById('whd_ok');
    expect(first?.deliveredAt).not.toBeNull();
    expect(first?.attemptCount).toBe(1);
    // re-run on a terminal delivery is a no-op (attemptCount stays 1).
    await handler({ delivery_id: 'whd_ok', endpoint_id: 'whe_ok', trace_id: 'tr-test', payload: {} });
    expect((await store().getDeliveryById('whd_ok'))?.attemptCount).toBe(1);
  });

  it('listStuckDeliveries returns enqueued, non-terminal, old deliveries', async () => {
    await seedDelivery('stuck', { enqueue: true });
    await getPool().query("UPDATE webhook_deliveries SET enqueued_at = now() - interval '20 minutes' WHERE id = 'whd_stuck'");
    const stuck = await store().listStuckDeliveries(new Date(Date.now() - 600_000), 10);
    expect(stuck.map((d) => d.id)).toContain('whd_stuck');
    // a freshly-enqueued delivery is NOT stuck.
    await seedDelivery('fresh', { enqueue: true });
    const stuck2 = await store().listStuckDeliveries(new Date(Date.now() - 600_000), 10);
    expect(stuck2.map((d) => d.id)).not.toContain('whd_fresh');
  });

  it('concurrent claimOrphanedDeliveries hands out DISJOINT batches (FOR UPDATE SKIP LOCKED)', async () => {
    const s = store();
    await s.create({ id: 'whe_c', url: 'https://hooks.example.com/in', secret: 'sek', eventTypes: null });
    for (let i = 0; i < 20; i++) {
      await s.recordDelivery({ id: `whd_c${i}`, endpointId: 'whe_c', eventType: 'skill.created', traceId: 'tr-test', payload: {} });
    }
    await getPool().query("UPDATE webhook_deliveries SET create_time = now() - interval '5 minutes'");

    // two reconcilers claim concurrently — no id appears in both batches, none lost.
    const [a, b] = await Promise.all([
      store().claimOrphanedDeliveries(new Date(), 20),
      store().claimOrphanedDeliveries(new Date(), 20),
    ]);
    const ids = [...a, ...b].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length); // disjoint — no double-claim
    expect(ids.length).toBe(20); // none lost
  });
});
