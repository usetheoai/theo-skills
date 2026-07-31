import { createId } from '@paralleldrive/cuid2';
import { type WebhookPayload } from '@usetheo/skills/contract';
import type PgBoss from 'pg-boss';

import { type Logger } from '../logger.js';
import {
  JOB_NAMES,
  type WebhookDeliveryJobData,
  WEBHOOK_DELIVERY_SEND_OPTIONS,
  WEBHOOK_DELIVERY_SINGLETON_SECONDS,
} from '../queue/queue.js';
import { type WebhookEndpointsStore } from '../store/webhook-endpoints-store.js';
import { type Clock, systemClock } from '../time/clock.js';
import { type OnOperationTerminal } from '../worker.js';

export interface WebhookEnqueuerDeps {
  readonly endpointsStore: WebhookEndpointsStore;
  readonly queue: PgBoss;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly idgen?: () => string;
}

/**
 * Build the `onTerminal` hook: on operation completion, fan out to every active
 * subscriber. Uses the transactional-outbox pattern — the delivery row is
 * persisted (enqueued_at NULL) BEFORE the job is sent, so a crash between the two
 * leaves a recoverable orphan that the reconciler re-enqueues. The job's
 * singletonKey dedups any reconciler re-enqueue that races the original send.
 *
 * Delivery semantics: AT-LEAST-ONCE. A crash between send and stampEnqueued, or a
 * reconciler sweep, can re-drive a delivery. Every POST carries a stable
 * `webhook-id` header (= delivery id, invariant across retries and re-drives) so
 * subscribers MUST dedup on it to achieve effectively-once processing.
 */
export function createWebhookEnqueuer(deps: WebhookEnqueuerDeps): OnOperationTerminal {
  const clock = deps.clock ?? systemClock;
  const idgen = deps.idgen ?? createId;
  return async ({ operationId, skillId, traceId, eventType, state }) => {
    const endpoints = await deps.endpointsStore.listActiveForEvent(eventType);
    if (endpoints.length === 0) {
      return;
    }
    const payload: WebhookPayload = {
      event_id: `evt_${idgen()}`,
      event_type: eventType,
      data: { skill_id: skillId, operation_id: operationId, state, occurred_at: clock.now().toISOString() },
    };
    for (const ep of endpoints) {
      const deliveryId = `whd_${idgen()}`;
      await deps.endpointsStore.recordDelivery({ id: deliveryId, endpointId: ep.id, eventType, payload, traceId });
      const jobData: WebhookDeliveryJobData = { delivery_id: deliveryId, endpoint_id: ep.id, trace_id: traceId, payload };
      await deps.queue.send(JOB_NAMES.WEBHOOK_DELIVERY, jobData, {
        ...WEBHOOK_DELIVERY_SEND_OPTIONS,
        singletonKey: deliveryId,
        singletonSeconds: WEBHOOK_DELIVERY_SINGLETON_SECONDS,
      });
      await deps.endpointsStore.stampEnqueued(deliveryId);
    }
    deps.logger.info(
      { operation_id: operationId, trace_id: traceId, event_type: eventType, fanout: endpoints.length },
      'webhook fan-out enqueued',
    );
  };
}
