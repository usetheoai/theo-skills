import { type WebhookSender } from '@usetheo/skills';
import type PgBoss from 'pg-boss';

import { type Logger } from '../logger.js';
import { JOB_NAMES, type WebhookDeliveryJobData, WEBHOOK_DELIVERY_DLQ_QUEUE_NAME } from '../queue/queue.js';
import { type WebhookEndpointsStore } from '../store/webhook-endpoints-store.js';
import { type Clock, systemClock } from '../time/clock.js';

import { UrlSafetyError } from './url-safety.js';
import { signWebhookBody } from './webhook-signing.js';

export interface WebhookDeliveryDeps {
  readonly endpointsStore: WebhookEndpointsStore;
  readonly sender: WebhookSender;
  readonly logger: Logger;
  readonly clock?: Clock;
}

export type WebhookDeliveryHandler = (data: WebhookDeliveryJobData) => Promise<void>;

/**
 * Deliver one webhook with retry classification:
 *  - 2xx        → delivered (terminal success)
 *  - 3xx / 4xx  → non-retriable failure (terminal; redirect:manual makes 3xx a failure)
 *  - 5xx        → throw → pg-boss retries with backoff, then dead-letters
 *  - network err→ throw → transient retry
 * Idempotent: a delivery already terminal (delivered/failed) is a no-op under retry.
 */
export function createWebhookDeliveryHandler(deps: WebhookDeliveryDeps): WebhookDeliveryHandler {
  const clock = deps.clock ?? systemClock;
  return async (data) => {
    const delivery = await deps.endpointsStore.getDeliveryById(data.delivery_id);
    if (delivery === undefined) {
      return; // delivery row gone (endpoint deleted) — nothing to do
    }
    if (delivery.deliveredAt !== null || delivery.failedAt !== null) {
      return; // idempotent no-op — already terminal
    }

    const endpoint = await deps.endpointsStore.getInternalById(data.endpoint_id);
    if (endpoint === undefined || !endpoint.active) {
      await deps.endpointsStore.markFailed(data.delivery_id);
      deps.logger.error({ delivery_id: data.delivery_id, trace_id: data.trace_id }, 'webhook endpoint missing/inactive — failed');
      return;
    }

    const body = JSON.stringify(data.payload);
    const ts = Math.floor(clock.now().getTime() / 1000);
    const signature = signWebhookBody(endpoint.secret, Buffer.from(body), ts);

    let status: number;
    try {
      const res = await deps.sender.send({
        url: endpoint.url,
        body,
        headers: {
          'content-type': 'application/json',
          'webhook-id': data.delivery_id,
          'webhook-signature': signature,
        },
      });
      status = res.status;
    } catch (err) {
      // Target resolved to a disallowed (private/rebind) address at delivery time —
      // a security failure, never retry; mark the delivery permanently failed.
      if (err instanceof UrlSafetyError) {
        await deps.endpointsStore.markFailed(data.delivery_id);
        deps.logger.error(
          { delivery_id: data.delivery_id, trace_id: data.trace_id, reason: err.reason },
          'webhook target unsafe at delivery time — failed (non-retriable)',
        );
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.info({ delivery_id: data.delivery_id, trace_id: data.trace_id, err: message }, 'webhook send error (will retry)');
      throw err instanceof Error ? err : new Error(message);
    }

    if (status >= 200 && status < 300) {
      await deps.endpointsStore.markDelivered(data.delivery_id);
      deps.logger.info({ delivery_id: data.delivery_id, trace_id: data.trace_id, status }, 'webhook delivered');
      return;
    }
    if (status >= 300 && status < 500) {
      await deps.endpointsStore.markFailed(data.delivery_id);
      deps.logger.error({ delivery_id: data.delivery_id, trace_id: data.trace_id, status }, 'webhook non-retriable failure');
      return;
    }
    // 5xx — transient. Throw so pg-boss retries with backoff (and dead-letters after retryLimit).
    deps.logger.info({ delivery_id: data.delivery_id, trace_id: data.trace_id, status }, 'webhook 5xx (will retry)');
    throw new Error(`webhook endpoint returned ${status}`);
  };
}

/** Dead-letter handler — retries exhausted, record the delivery as failed. */
export function createWebhookDlqHandler(deps: Pick<WebhookDeliveryDeps, 'endpointsStore' | 'logger'>): WebhookDeliveryHandler {
  return async (data) => {
    await deps.endpointsStore.markFailed(data.delivery_id);
    deps.logger.error({ delivery_id: data.delivery_id, trace_id: data.trace_id }, 'webhook delivery dead-lettered (retries exhausted)');
  };
}

export interface RegisterWebhookWorkerDeps {
  readonly queue: PgBoss;
  readonly deliveryHandler: WebhookDeliveryHandler;
  readonly dlqHandler: WebhookDeliveryHandler;
}

/** Register the webhook-delivery consumer + its dead-letter consumer. */
export async function registerWebhookWorker(deps: RegisterWebhookWorkerDeps): Promise<void> {
  await deps.queue.work<WebhookDeliveryJobData>(
    JOB_NAMES.WEBHOOK_DELIVERY,
    { pollingIntervalSeconds: 1, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        await deps.deliveryHandler(job.data);
      }
    },
  );
  await deps.queue.work<WebhookDeliveryJobData>(
    WEBHOOK_DELIVERY_DLQ_QUEUE_NAME,
    { pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        await deps.dlqHandler(job.data);
      }
    },
  );
}
