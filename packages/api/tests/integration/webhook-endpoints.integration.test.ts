import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { registerWebhookEndpointRoutes } from '../../src/server/handlers/webhook-endpoints.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';
import { createWebhookEndpointsStore } from '../../src/server/store/webhook-endpoints-store.js';
import { type DnsResolver } from '../../src/server/webhooks/url-safety.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const publicResolver: DnsResolver = {
  resolve4: () => Promise.resolve(['93.184.216.34']),
  resolve6: () => Promise.resolve([]),
};

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  registerWebhookEndpointRoutes(app, {
    endpointsStoreFor: (ws: string) => createWebhookEndpointsStore(createDb(getPool()), ws),
    logger: createNoopLogger(),
    dnsResolver: publicResolver,
  });
  return app;
}

describeIntegration('webhook endpoints CRUD + store (T3.1-T3.3)', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('creates an endpoint returning the secret once, then never exposes it again', async () => {
    const app = buildApp();
    const res = await app.request('/v1/webhookEndpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/wh', event_types: ['skill.created'] }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; secret: string; event_types: string[] };
    expect(created.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(created.event_types).toEqual(['skill.created']);

    const got = await app.request(`/v1/webhookEndpoints/${created.id}`);
    expect(got.status).toBe(200);
    const body = (await got.json()) as Record<string, unknown>;
    expect(body['secret']).toBeUndefined(); // secret never re-exposed
    expect(body['url']).toBe('https://example.com/wh');
  });

  it('rejects a private/loopback URL with 400 url_unsafe (SSRF guard)', async () => {
    const app = buildApp();
    const res = await app.request('/v1/webhookEndpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'url_unsafe' });
  });

  it('rejects a malformed body with 400', async () => {
    const app = buildApp();
    const res = await app.request('/v1/webhookEndpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('lists, then deletes (404 afterwards)', async () => {
    const app = buildApp();
    await app.request('/v1/webhookEndpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://a.example.com/wh' }),
    });
    const createRes = await app.request('/v1/webhookEndpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://b.example.com/wh' }),
    });
    const id = ((await createRes.json()) as { id: string }).id;

    const list = (await (await app.request('/v1/webhookEndpoints')).json()) as { endpoints: unknown[] };
    expect(list.endpoints).toHaveLength(2);

    expect((await app.request(`/v1/webhookEndpoints/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/v1/webhookEndpoints/${id}`)).status).toBe(404);
    expect((await app.request(`/v1/webhookEndpoints/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('listActiveForEvent honors the event-type filter (null/empty = all)', async () => {
    const store = createWebhookEndpointsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.create({ id: 'whe_all', url: 'https://all.example', secret: 's1', eventTypes: null });
    await store.create({ id: 'whe_created', url: 'https://c.example', secret: 's2', eventTypes: ['skill.created'] });
    await store.create({ id: 'whe_deleted', url: 'https://d.example', secret: 's3', eventTypes: ['skill.deleted'] });

    const forCreated = await store.listActiveForEvent('skill.created');
    expect(forCreated.map((e) => e.id).sort()).toEqual(['whe_all', 'whe_created']);
  });

  it('records a delivery, stamps enqueued, marks delivered (attempt bumped)', async () => {
    const store = createWebhookEndpointsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.create({ id: 'whe_d', url: 'https://d.example', secret: 's', eventTypes: null });
    const did = `whd_${createId()}`;
    await store.recordDelivery({ id: did, endpointId: 'whe_d', eventType: 'skill.created', traceId: 'tr-test', payload: { a: 1 } });

    let row = await store.getDeliveryById(did);
    expect(row?.enqueuedAt).toBeNull();
    expect(row?.attemptCount).toBe(0);

    await store.stampEnqueued(did);
    row = await store.getDeliveryById(did);
    expect(row?.enqueuedAt).not.toBeNull();

    await store.markDelivered(did);
    row = await store.getDeliveryById(did);
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.attemptCount).toBe(1);
  });

  it('claimOrphanedDeliveries recovers an un-enqueued delivery exactly once', async () => {
    const store = createWebhookEndpointsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.create({ id: 'whe_o', url: 'https://o.example', secret: 's', eventTypes: null });
    const orphan = `whd_${createId()}`;
    await store.recordDelivery({ id: orphan, endpointId: 'whe_o', eventType: 'skill.created', traceId: 'tr-test', payload: {} });
    // make it "old" so the orphan window (anything older than now) catches it.
    await getPool().query("UPDATE webhook_deliveries SET create_time = now() - interval '10 minutes' WHERE id = $1", [orphan]);

    const claimed = await store.claimOrphanedDeliveries(new Date(), 10);
    expect(claimed.map((r) => r.id)).toContain(orphan);

    // second sweep finds nothing — enqueued_at was stamped on claim.
    const again = await store.claimOrphanedDeliveries(new Date(), 10);
    expect(again.map((r) => r.id)).not.toContain(orphan);
  });
});
