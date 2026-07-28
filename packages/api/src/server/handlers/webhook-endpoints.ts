import { randomBytes } from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { WebhookEndpointCreateSchema } from '@usetheo/skills/contract';
import { type Hono } from 'hono';

import { type Logger } from '../logger.js';
import { type WebhookEndpointsStore } from '../store/webhook-endpoints-store.js';
import { assertPublicUrl, type DnsResolver, UrlSafetyError } from '../webhooks/url-safety.js';

export interface WebhookEndpointsRoutesDeps {
  readonly endpointsStore: WebhookEndpointsStore;
  readonly logger: Logger;
  /** Injectable for tests; defaults to real DNS in url-safety. */
  readonly dnsResolver?: DnsResolver;
}

function newSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

export function registerWebhookEndpointRoutes(app: Hono, deps: WebhookEndpointsRoutesDeps): void {
  // POST /v1/webhookEndpoints — register a subscriber. Secret is returned ONCE.
  app.post('/v1/webhookEndpoints', async (c) => {
    const json: unknown = await c.req.json().catch(() => undefined);
    const parsed = WebhookEndpointCreateSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
    }

    // SSRF guard — reject private/loopback/metadata targets before persisting.
    try {
      await assertPublicUrl(parsed.data.url, deps.dnsResolver);
    } catch (err) {
      if (err instanceof UrlSafetyError) {
        return c.json({ error: 'url_unsafe', reason: err.reason }, 400);
      }
      throw err;
    }

    const id = `whe_${createId()}`;
    const secret = newSecret();
    const eventTypes = parsed.data.event_types ?? null;
    await deps.endpointsStore.create({ id, url: parsed.data.url, secret, eventTypes });

    const created = await deps.endpointsStore.getPublicById(id);
    if (created === undefined) {
      // Should be impossible immediately after a successful insert.
      return c.json({ error: 'internal_error' }, 500);
    }
    deps.logger.info({ endpoint_id: id, url: parsed.data.url }, 'webhook endpoint created');
    // The ONLY response that ever carries the secret.
    return c.json({ ...created, secret }, 201);
  });

  // GET /v1/webhookEndpoints — list (public view, no secrets).
  app.get('/v1/webhookEndpoints', async (c) => {
    return c.json({ endpoints: await deps.endpointsStore.listPublic() }, 200);
  });

  // GET /v1/webhookEndpoints/:id
  app.get('/v1/webhookEndpoints/:id', async (c) => {
    const endpoint = await deps.endpointsStore.getPublicById(c.req.param('id'));
    if (endpoint === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(endpoint, 200);
  });

  // DELETE /v1/webhookEndpoints/:id
  app.delete('/v1/webhookEndpoints/:id', async (c) => {
    const removed = await deps.endpointsStore.remove(c.req.param('id'));
    if (!removed) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });
}
