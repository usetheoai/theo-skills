import { createStubEmbedder, DEFAULT_WORKSPACE_ID }  from '@usetheo/skills';
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

async function pollOp(app: Hono<AppEnv>, opId: string, target: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const op = (await (await app.request(`/v1/operations/${opId}`)).json()) as { state: string };
    if (op.state === target || op.state === 'FAILED') return op.state;
    await sleep(50);
  }
  throw new Error('not terminal');
}

async function waitForEmbedding(skillId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const r = await getPool().query<{ c: string }>('SELECT count(*)::text AS c FROM embeddings WHERE skill_id = $1', [skillId]);
    if (Number(r.rows[0]?.c ?? '0') > 0) return;
    await sleep(50);
  }
  throw new Error('embedding not produced');
}

/** POST a skill whose SKILL.md frontmatter carries name + description. */
async function postSkill(app: Hono<AppEnv>, skillId: string, name: string, description: string): Promise<void> {
  const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd(name, description) }]);
  const res = await app.request('/v1/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_id: skillId, zippedFilesystem: zip }),
  });
  expect(res.status, `POST ${skillId}`).toBe(202);
  const opId = ((await res.json()) as { operation_id: string }).operation_id;
  expect(await pollOp(app, opId, 'ACTIVE')).toBe('ACTIVE');
  await waitForEmbedding(skillId);
}

describeIntegration('M4 E2E: index via POST → retrieve hybrid scored (T4.3)', () => {
  let boss: PgBoss;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    boss = await startBoss();
    const embeddingsStore = createEmbeddingsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const embedEnqueuer = createEmbedEnqueuer({ queue: boss, embeddingsStore, logger: createNoopLogger() });
    const h = buildWorkerHandlers(getPool(), createNoopLogger(), embedEnqueuer);
    await registerWorker({ queue: boss, createHandler: h.createHandler, updateHandler: h.updateHandler, deleteHandler: h.deleteHandler });
    await registerEmbedWorker({ queue: boss, handler: createEmbedSkillHandler({ embeddingsStore, embedder: createStubEmbedder(), logger: createNoopLogger() }), logger: createNoopLogger() });
  });
  beforeEach(truncateAll);
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('creating skills then retrieving returns the relevant skill on top with a score', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), embedder: createStubEmbedder() });
    await postSkill(app, 'pdf-tool', 'pdf-summarizer', 'summarizes and condenses pdf documents');
    await postSkill(app, 'img-tool', 'image-resizer', 'resizes and crops images');

    const res = await app.request('/v1/skills:retrieve?query=summarize%20a%20pdf%20document&topK=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { skill_id: string; score: number }[] };
    expect(body.results[0]?.skill_id).toBe('pdf-tool'); // relevant skill ranks first
    expect(typeof body.results[0]?.score).toBe('number');
  });

  it('each strategy returns results end-to-end', async () => {
    app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), embedder: createStubEmbedder() });
    await postSkill(app, 'translate-tool', 'language-translator', 'translates text between languages');

    for (const strategy of ['vector', 'keyword', 'hybrid']) {
      const res = await app.request(`/v1/skills:retrieve?query=translate%20text&strategy=${strategy}`);
      expect(res.status, strategy).toBe(200);
      const body = (await res.json()) as { results: unknown[] };
      expect(Array.isArray(body.results)).toBe(true);
    }
  });
});
