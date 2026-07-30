import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';
import { createOperationsStore } from '../../src/server/store/operations-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';
import { buildWorkerHandlers } from '../../src/server/wiring.js';
import { createCreateSkillHandler, registerWorker } from '../../src/server/worker.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function pollState(app: Hono<AppEnv>, opId: string, target: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const op = (await (await app.request(`/v1/operations/${opId}`)).json()) as { state: string };
    if (op.state === target || op.state === 'FAILED') {
      return op.state;
    }
    await sleep(50);
  }
  throw new Error('not terminal');
}

describeIntegration('operation lifecycle: states, idempotency, retry (T1.1)', () => {
  let boss: PgBoss;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    boss = await startBoss();
    const h = buildWorkerHandlers(getPool(), createNoopLogger());
    await registerWorker({ queue: boss, createHandler: h.createHandler, updateHandler: h.updateHandler, deleteHandler: h.deleteHandler });
  });
  beforeEach(truncateAll);
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('resending the same Idempotency-Key returns the same operation (one skill)', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger() });
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('idem-skill') }]);
    const post = () =>
      app.request('/v1/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'key-123' },
        body: JSON.stringify({ skill_id: 'idem-skill', zippedFilesystem: zip }),
      });
    const op1 = ((await (await post()).json()) as { operation_id: string }).operation_id;
    const op2 = ((await (await post()).json()) as { operation_id: string }).operation_id;
    expect(op2).toBe(op1); // idempotent replay — same operation

    expect(await pollState(app, op1, 'ACTIVE')).toBe('ACTIVE');
    const count = await getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM operations WHERE skill_id = 'idem-skill'",
    );
    expect(count.rows[0]?.count).toBe('1'); // exactly one operation row
  });

  it('worker marks a business-rule failure FAILED without retry, and is idempotent on terminal ops', async () => {
    const db = createDb(getPool());
    const ops = createOperationsStore(db, DEFAULT_WORKSPACE_ID);
    const skills = createSkillsStore(db, DEFAULT_WORKSPACE_ID);
    // pre-create the skill so createWithRevision hits the unique constraint (business rule).
    await skills.createWithRevision({
      skillId: 'dup', name: 'X', description: '', payload: Buffer.from('z'), contentHash: 'h', frontmatter: {}, skillMd: '# X',
    });
    await ops.create({ operationId: 'op_dup', skillId: 'dup', type: 'create_skill', initialState: 'CREATING' });

    const handle = createCreateSkillHandler({ skillsStoreFor: () => skills, operationsStoreFor: () => ops, logger: createNoopLogger() });
    // retryCount 0 — business rule must NOT throw (no retry) and mark FAILED.
    await handle(
      { operation_id: 'op_dup', skill_id: 'dup', trace_id: 'tr-test', name: 'Y', description: '', content_hash: 'h2', payload_b64: Buffer.from('z2').toString('base64'), frontmatter: {}, skill_md: '# Y' },
      0,
    );
    expect((await ops.get('op_dup'))?.state).toBe('FAILED');

    // re-running on a terminal operation is an idempotent no-op (state unchanged).
    await handle(
      { operation_id: 'op_dup', skill_id: 'dup', trace_id: 'tr-test', name: 'Y', description: '', content_hash: 'h2', payload_b64: Buffer.from('z2').toString('base64'), frontmatter: {}, skill_md: '# Y' },
      0,
    );
    expect((await ops.get('op_dup'))?.state).toBe('FAILED');
  });

  it('worker RETRIES a transient error and reaches ACTIVE on a later attempt', async () => {
    const db = createDb(getPool());
    const ops = createOperationsStore(db, DEFAULT_WORKSPACE_ID);
    const realSkills = createSkillsStore(db, DEFAULT_WORKSPACE_ID);
    await ops.create({ operationId: 'op_t', skillId: 'transient', type: 'create_skill', initialState: 'CREATING' });

    let attempts = 0;
    const flakySkills = {
      ...realSkills,
      createWithRevision: (input: Parameters<typeof realSkills.createWithRevision>[0]) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient db blip'); // plain error → must retry, NOT mark FAILED
        }
        return realSkills.createWithRevision(input);
      },
    };
    const handle = createCreateSkillHandler({ skillsStoreFor: () => flakySkills, operationsStoreFor: () => ops, logger: createNoopLogger() });
    const data = { operation_id: 'op_t', skill_id: 'transient', trace_id: 'tr-test', name: 'T', description: '', content_hash: 'h', payload_b64: Buffer.from('z').toString('base64'), frontmatter: {}, skill_md: '# T' };

    // attempt 0: transient throw → re-thrown (pg-boss would retry), state still CREATING.
    await expect(handle(data, 0)).rejects.toThrow('transient db blip');
    expect((await ops.get('op_t'))?.state).toBe('CREATING');
    // attempt 1: succeeds → ACTIVE.
    await handle(data, 1);
    expect((await ops.get('op_t'))?.state).toBe('ACTIVE');
  });

  it('two CONCURRENT requests with the same Idempotency-Key create exactly one operation', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger() });
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('race-skill') }]);
    const post = () =>
      app.request('/v1/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'race-key' },
        body: JSON.stringify({ skill_id: 'race-skill', zippedFilesystem: zip }),
      });
    const [r1, r2] = await Promise.all([post(), post()]);
    const id1 = ((await r1.json()) as { operation_id: string }).operation_id;
    const id2 = ((await r2.json()) as { operation_id: string }).operation_id;
    expect(id1).toBe(id2); // both resolve to the same operation under contention

    const count = await getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM operations WHERE skill_id = 'race-skill'",
    );
    expect(count.rows[0]?.count).toBe('1'); // partial-unique index arbitrated the race
  });
});
