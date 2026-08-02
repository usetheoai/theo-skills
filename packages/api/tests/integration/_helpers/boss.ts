import type PgBoss from 'pg-boss';

import {
  createQueue,
  EMBED_SKILL_DLQ_QUEUE_NAME,
  JOB_NAMES,
  WEBHOOK_DELIVERY_DLQ_QUEUE_NAME,
} from '../../../src/server/queue/queue.js';

import { PG_URI } from './env.js';

/** Start a real pg-boss bound to the test DB and ensure the job queues. */
export async function startBoss(): Promise<PgBoss> {
  const boss = createQueue(PG_URI, { info: () => undefined, error: () => undefined });
  await boss.start();
  await boss.createQueue(JOB_NAMES.CREATE_SKILL);
  await boss.createQueue(JOB_NAMES.UPDATE_SKILL);
  await boss.createQueue(JOB_NAMES.DELETE_SKILL);
  await boss.createQueue(JOB_NAMES.WEBHOOK_DELIVERY);
  await boss.createQueue(WEBHOOK_DELIVERY_DLQ_QUEUE_NAME);
  await boss.createQueue(JOB_NAMES.EMBED_SKILL);
  await boss.createQueue(EMBED_SKILL_DLQ_QUEUE_NAME);
  return boss;
}
