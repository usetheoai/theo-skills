import { createStubEmbedder, type EmbeddingProvider, stubEmbed, DEFAULT_WORKSPACE_ID }  from '@usetheo/skills';
import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createEmbedEnqueuer, createEmbedSkillHandler, registerEmbedWorker } from '../../src/server/embed/embed-worker.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';
import { createEmbeddingsStore } from '../../src/server/store/embeddings-store.js';
import { buildWorkerHandlers } from '../../src/server/wiring.js';
import { registerWorker } from '../../src/server/worker.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const toSql = (v: number[]): string => `[${v.join(',')}]`;

// Mutable holder so workers are registered ONCE; tests swap the active embedder.
const holder: { current: EmbeddingProvider } = { current: createStubEmbedder() };
const proxyEmbedder: EmbeddingProvider = {
  get provider() {
    return holder.current.provider;
  },
  get model() {
    return holder.current.model;
  },
  embed: (t, o) => holder.current.embed(t, o),
  embedBatch: (t, o) => holder.current.embedBatch(t, o),
};

async function pollOp(app: Hono<AppEnv>, opId: string, target: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const op = (await (await app.request(`/v1/operations/${opId}`)).json()) as { state: string };
    if (op.state === target || op.state === 'FAILED') return op.state;
    await sleep(50);
  }
  throw new Error('operation not terminal');
}

async function waitForEmbedding(skillId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const r = await getPool().query<{ count: string }>('SELECT count(*)::text AS count FROM embeddings WHERE skill_id = $1', [skillId]);
    if (Number(r.rows[0]?.count ?? '0') > 0) return;
    await sleep(50);
  }
  throw new Error('embedding not produced');
}

async function postSkill(app: Hono<AppEnv>, skillId: string): Promise<string> {
  const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd(skillId) }]);
  const res = await app.request('/v1/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_id: skillId, zippedFilesystem: zip }),
  });
  return ((await res.json()) as { operation_id: string }).operation_id;
}

describeIntegration('M3 E2E: create skill → embedding present + queryable; provider swap (T4.1/T4.2)', () => {
  let boss: PgBoss;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    boss = await startBoss();
    const embeddingsStore = createEmbeddingsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const embedEnqueuer = createEmbedEnqueuer({ queue: boss, embeddingsStore, logger: createNoopLogger() });
    const h = buildWorkerHandlers(getPool(), createNoopLogger(), embedEnqueuer);
    await registerWorker({ queue: boss, createHandler: h.createHandler, updateHandler: h.updateHandler, deleteHandler: h.deleteHandler });
    await registerEmbedWorker({ queue: boss, handler: createEmbedSkillHandler({ embeddingsStore, embedder: proxyEmbedder, logger: createNoopLogger() }), logger: createNoopLogger() });
  });
  beforeEach(async () => {
    await truncateAll();
    holder.current = createStubEmbedder();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('creating a skill produces a queryable embedding (stub provider)', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger() });
    const opId = await postSkill(app, 'e2e-embed');
    expect(await pollOp(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await waitForEmbedding('e2e-embed');

    // queryable by cosine similarity — with a single skill, it is the nearest hit.
    const q = await getPool().query<{ skill_id: string }>(
      `SELECT skill_id FROM embeddings ORDER BY vector <=> $1::vector ASC LIMIT 1`,
      [toSql(stubEmbed('anything'))],
    );
    expect(q.rows[0]?.skill_id).toBe('e2e-embed');
  });

  it('swapping the provider does not touch the domain (same port, different embedder)', async () => {
    // Stand-in for "another provider": same port, distinct provider/model tag —
    // the worker + port code path is identical; only the injected embedder differs.
    holder.current = { ...createStubEmbedder(), provider: 'openai', model: 'swapped-model' };
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger() });
    const opId = await postSkill(app, 'e2e-swap');
    expect(await pollOp(app, opId, 'ACTIVE')).toBe('ACTIVE');

    await waitForEmbedding('e2e-swap');
    const r = await getPool().query<{ provider: string; model: string }>(
      'SELECT provider, model FROM embeddings WHERE skill_id = $1',
      ['e2e-swap'],
    );
    expect(r.rows[0]).toMatchObject({ provider: 'openai', model: 'swapped-model' });
  });

  it('updating a skill produces a NEW embedding for the new revision (reindex on update)', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger() });
    const opId = await postSkill(app, 'e2e-update');
    expect(await pollOp(app, opId, 'ACTIVE')).toBe('ACTIVE');
    await waitForEmbedding('e2e-update');
    const firstRev = (await getPool().query<{ revision_id: string }>(
      'SELECT revision_id FROM embeddings WHERE skill_id = $1',
      ['e2e-update'],
    )).rows[0]?.revision_id;

    // PATCH a new payload → new revision → a second embedding row for it.
    const zip2 = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('e2e-update') + '\n\nupdated body' }]);
    const patch = await app.request('/v1/skills/e2e-update?updateMask=zippedFilesystem', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zippedFilesystem: zip2 }),
    });
    await pollOp(app, ((await patch.json()) as { operation_id: string }).operation_id, 'ACTIVE');

    for (let i = 0; i < 200; i++) {
      const n = Number((await getPool().query<{ count: string }>('SELECT count(*)::text AS count FROM embeddings WHERE skill_id = $1', ['e2e-update'])).rows[0]?.count ?? '0');
      if (n >= 2) break;
      await sleep(50);
    }
    const revs = await getPool().query<{ revision_id: string }>('SELECT DISTINCT revision_id FROM embeddings WHERE skill_id = $1', ['e2e-update']);
    expect(revs.rows).toHaveLength(2); // one per revision
    expect(revs.rows.map((x) => x.revision_id)).toContain(firstRev);
  });

  it('ranks the matching skill first among several (cosine ordering is real)', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger() });
    for (const id of ['rank-a', 'rank-b', 'rank-c']) {
      const op = await postSkill(app, id);
      expect(await pollOp(app, op, 'ACTIVE')).toBe('ACTIVE');
      await waitForEmbedding(id);
    }
    // query with rank-b's own stored vector → it must rank first, ahead of a/c.
    const top = await getPool().query<{ skill_id: string }>(
      `SELECT skill_id FROM embeddings
       ORDER BY vector <=> (SELECT vector FROM embeddings WHERE skill_id = 'rank-b') ASC
       LIMIT 1`,
    );
    expect(top.rows[0]?.skill_id).toBe('rank-b'); // nearest to itself among 3 distinct skills
  });
});
