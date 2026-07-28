/**
 * Test-support entry (`@usetheo/skills-api/testkit`) — boots an in-process
 * registry (HTTP app + create/update/delete workers) bound to a Postgres URI and
 * exposes it as a `fetch`-shaped function. Lets sibling packages (the CLI) run a
 * real validate→publish→retrieve E2E WITHOUT importing pg / pg-boss / hono types.
 */
import { Pool } from 'pg';

import { createApp } from './server/app.js';
import { createQueue, JOB_NAMES } from './server/queue/queue.js';
import { buildWorkerHandlers } from './server/wiring.js';
import { registerWorker } from './server/worker.js';

export interface TestRegistry {
  /** `fetch`-shaped: routes calls into the in-process app (any host accepted). */
  readonly fetch: typeof globalThis.fetch;
  /** Reset all domain tables between cases. */
  truncate(): Promise<void>;
  /** Stop the queue + close the pool. */
  stop(): Promise<void>;
}

export async function startTestRegistry(pgUri: string): Promise<TestRegistry> {
  const pool = new Pool({ connectionString: pgUri });
  const queue = createQueue(pgUri);
  await queue.start();
  await queue.createQueue(JOB_NAMES.CREATE_SKILL);
  await queue.createQueue(JOB_NAMES.UPDATE_SKILL);
  await queue.createQueue(JOB_NAMES.DELETE_SKILL);
  const h = buildWorkerHandlers(pool);
  await registerWorker({
    queue,
    createHandler: h.createHandler,
    updateHandler: h.updateHandler,
    deleteHandler: h.deleteHandler,
  });
  const app = createApp({ pool, queue });
  const fetch = ((input: string | URL | Request, init?: RequestInit) =>
    app.request(input, init)) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    async truncate() {
      await pool.query(
        'TRUNCATE TABLE embeddings, webhook_deliveries, webhook_endpoints, operations, skill_revisions, skills RESTART IDENTITY CASCADE',
      );
    },
    async stop() {
      await queue.stop();
      await pool.end();
    },
  };
}
