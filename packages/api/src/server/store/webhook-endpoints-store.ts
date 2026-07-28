import { type WebhookEndpoint, type WebhookEventType } from '@usetheo/skills/contract';
import { type WebhookDeliveryRow, webhookDeliveries, webhookEndpoints } from '@usetheo/skills/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { type Db } from '../db.js';

/** Active endpoint reduced to what fan-out + signing need. */
export interface ActiveEndpoint {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
}

/** Internal endpoint view including the secret (delivery worker needs it to sign). */
export interface InternalEndpoint {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  readonly active: boolean;
}

export interface NewEndpoint {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  readonly eventTypes: readonly WebhookEventType[] | null;
}

export interface NewDelivery {
  readonly id: string;
  readonly endpointId: string;
  readonly eventType: string;
  readonly payload: unknown;
  /** M9: correlation id carried from the triggering operation. */
  readonly traceId: string;
}

/** Domain view of a delivery row (port boundary — no ORM type leaks out). */
export interface DeliveryRecord {
  readonly id: string;
  readonly endpointId: string;
  readonly eventType: string;
  readonly payload: unknown;
  /** M9: correlation id — survives the orphan-reconciler re-enqueue. */
  readonly traceId: string;
  readonly attemptCount: number;
  readonly deliveredAt: Date | null;
  readonly failedAt: Date | null;
  readonly enqueuedAt: Date | null;
  readonly createTime: Date;
}

export interface WebhookEndpointsStore {
  /** Persist a new endpoint (id + secret are caller-generated). */
  create(input: NewEndpoint): Promise<void>;
  /** Public view by id (never exposes the secret), or undefined. */
  getPublicById(id: string): Promise<WebhookEndpoint | undefined>;
  /** All endpoints, newest first (public view). */
  listPublic(): Promise<WebhookEndpoint[]>;
  /** Remove an endpoint (cascade deletes its deliveries). Returns false if absent. */
  remove(id: string): Promise<boolean>;
  /** Active endpoints subscribed to `eventType` (null/empty filter = all events). */
  listActiveForEvent(eventType: WebhookEventType): Promise<ActiveEndpoint[]>;
  /** Internal view (incl. secret) by id — used by the delivery worker to sign. */
  getInternalById(id: string): Promise<InternalEndpoint | undefined>;

  /** Outbox insert — a delivery row with no enqueued/delivered/failed stamp. */
  recordDelivery(input: NewDelivery): Promise<void>;
  /** Fetch a delivery (domain view) by id, or undefined. */
  getDeliveryById(id: string): Promise<DeliveryRecord | undefined>;
  /** Mark a delivery as enqueued (claims it out of the orphan scan). */
  stampEnqueued(deliveryId: string): Promise<void>;
  /** Terminal success — sets delivered_at and bumps the attempt counter. */
  markDelivered(deliveryId: string): Promise<void>;
  /** Terminal failure — sets failed_at and bumps the attempt counter. */
  markFailed(deliveryId: string): Promise<void>;
  /**
   * Recover orphaned deliveries (recorded but never enqueued — a crash between
   * outbox insert and enqueue). Claims them atomically via FOR UPDATE SKIP LOCKED
   * and stamps enqueued_at so a concurrent reconciler cannot double-claim.
   */
  claimOrphanedDeliveries(olderThan: Date, limit: number): Promise<DeliveryRecord[]>;
  /**
   * Recover STUCK deliveries — enqueued but never reached a terminal stamp and
   * older than `olderThan` (a lost dead-letter event would otherwise leave them
   * non-terminal forever, invisible to the orphan scan). Returned for re-enqueue;
   * the job singletonKey dedups against any still-live original job.
   */
  listStuckDeliveries(olderThan: Date, limit: number): Promise<DeliveryRecord[]>;
}

function toPublic(row: {
  id: string;
  url: string;
  active: boolean;
  eventTypes: unknown;
  createTime: Date;
}): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    active: row.active,
    event_types: (row.eventTypes as WebhookEventType[] | null) ?? null,
    create_time: row.createTime.toISOString(),
  };
}

function toRecord(row: WebhookDeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventType: row.eventType,
    payload: row.payload,
    traceId: row.traceId,
    attemptCount: row.attemptCount,
    deliveredAt: row.deliveredAt,
    failedAt: row.failedAt,
    enqueuedAt: row.enqueuedAt,
    createTime: row.createTime,
  };
}

export function createWebhookEndpointsStore(db: Db): WebhookEndpointsStore {
  return {
    async create(input) {
      await db.insert(webhookEndpoints).values({
        id: input.id,
        url: input.url,
        secret: input.secret,
        active: true,
        eventTypes: input.eventTypes === null ? null : [...input.eventTypes],
      });
    },

    async getPublicById(id) {
      const rows = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toPublic(row);
    },

    async listPublic() {
      const rows = await db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createTime));
      return rows.map(toPublic);
    },

    async remove(id) {
      const deleted = await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
      return deleted.length > 0;
    },

    async listActiveForEvent(eventType) {
      // null/empty event_types = subscribe to all; otherwise the jsonb array must contain the event.
      const rows = await db
        .select({ id: webhookEndpoints.id, url: webhookEndpoints.url, secret: webhookEndpoints.secret })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.active, true),
            sql`(${webhookEndpoints.eventTypes} IS NULL
                 OR jsonb_array_length(${webhookEndpoints.eventTypes}) = 0
                 OR ${webhookEndpoints.eventTypes} @> ${JSON.stringify([eventType])}::jsonb)`,
          ),
        );
      return rows;
    },

    async getInternalById(id) {
      const rows = await db
        .select({ id: webhookEndpoints.id, url: webhookEndpoints.url, secret: webhookEndpoints.secret, active: webhookEndpoints.active })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, id))
        .limit(1);
      return rows[0];
    },

    async recordDelivery(input) {
      await db.insert(webhookDeliveries).values({
        id: input.id,
        endpointId: input.endpointId,
        eventType: input.eventType,
        payload: input.payload,
        traceId: input.traceId,
      });
    },

    async getDeliveryById(id) {
      const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toRecord(row);
    },

    async stampEnqueued(deliveryId) {
      await db
        .update(webhookDeliveries)
        .set({ enqueuedAt: new Date() })
        .where(eq(webhookDeliveries.id, deliveryId));
    },

    async markDelivered(deliveryId) {
      // Terminal-once: never overwrite an already-terminal delivery (idempotent under retry/DLQ).
      await db
        .update(webhookDeliveries)
        .set({ deliveredAt: new Date(), attemptCount: sql`${webhookDeliveries.attemptCount} + 1` })
        .where(and(eq(webhookDeliveries.id, deliveryId), isNull(webhookDeliveries.deliveredAt), isNull(webhookDeliveries.failedAt)));
    },

    async markFailed(deliveryId) {
      await db
        .update(webhookDeliveries)
        .set({ failedAt: new Date(), attemptCount: sql`${webhookDeliveries.attemptCount} + 1` })
        .where(and(eq(webhookDeliveries.id, deliveryId), isNull(webhookDeliveries.deliveredAt), isNull(webhookDeliveries.failedAt)));
    },

    async claimOrphanedDeliveries(olderThan, limit) {
      const result = await db.execute(sql`
        WITH claimed AS (
          SELECT id FROM webhook_deliveries
          WHERE delivered_at IS NULL AND failed_at IS NULL AND enqueued_at IS NULL
            AND create_time < ${olderThan.toISOString()}
          ORDER BY create_time
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE webhook_deliveries d
        SET enqueued_at = now()
        FROM claimed
        WHERE d.id = claimed.id
        RETURNING d.id, d.endpoint_id AS "endpointId", d.event_type AS "eventType",
                  d.payload, d.trace_id AS "traceId", d.attempt_count AS "attemptCount",
                  d.delivered_at AS "deliveredAt", d.failed_at AS "failedAt",
                  d.enqueued_at AS "enqueuedAt", d.create_time AS "createTime"
      `);
      return (result.rows as unknown as WebhookDeliveryRow[]).map(toRecord);
    },

    async listStuckDeliveries(olderThan, limit) {
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            isNull(webhookDeliveries.deliveredAt),
            isNull(webhookDeliveries.failedAt),
            sql`${webhookDeliveries.enqueuedAt} IS NOT NULL`,
            sql`${webhookDeliveries.enqueuedAt} < ${olderThan.toISOString()}`,
          ),
        )
        .orderBy(webhookDeliveries.enqueuedAt)
        .limit(limit);
      return rows.map(toRecord);
    },
  } satisfies WebhookEndpointsStore;
}
