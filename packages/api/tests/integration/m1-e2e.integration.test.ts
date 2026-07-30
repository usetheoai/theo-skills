import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';
import { buildWorkerHandlers } from '../../src/server/wiring.js';
import { registerWorker } from '../../src/server/worker.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface OpBody {
  state: 'CREATING' | 'UPDATING' | 'DELETING' | 'ACTIVE' | 'FAILED';
  error: string | null;
}

async function postSkill(app: Hono<AppEnv>, skillId: string, zip: string): Promise<Response> {
  return app.request('/v1/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_id: skillId, zippedFilesystem: zip }),
  });
}

async function pollDone(app: Hono<AppEnv>, opId: string): Promise<OpBody> {
  for (let i = 0; i < 200; i++) {
    const res = await app.request(`/v1/operations/${opId}`);
    const op = (await res.json()) as OpBody;
    if (op.state === 'ACTIVE') {
      return op;
    }
    if (op.state === 'FAILED') {
      throw new Error(`operation failed: ${op.error ?? ''}`);
    }
    await sleep(50);
  }
  throw new Error('operation did not complete');
}

describeIntegration('M1 skill ingestion E2E (T4)', () => {
  let boss: PgBoss;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    boss = await startBoss();
    const handlers = buildWorkerHandlers(getPool(), createNoopLogger());
    await registerWorker({
      queue: boss,
      createHandler: handlers.createHandler,
      updateHandler: handlers.updateHandler,
      deleteHandler: handlers.deleteHandler,
    });
  });
  beforeEach(truncateAll);
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  function makeApp(): Hono<AppEnv> {
    return createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), reservationHours: 1 });
  }

  it('POST valid payload → done → GET skill has frontmatter name/description + a revision', async () => {
    app = makeApp();
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('demo-skill', 'Manages X. Use when Y.') }]);
    const res = await postSkill(app, 'demo-skill', zip);
    expect(res.status).toBe(202);
    const { operation_id } = (await res.json()) as { operation_id: string };
    await pollDone(app, operation_id);

    const get = await app.request('/v1/skills/demo-skill');
    expect(get.status).toBe(200);
    const skill = (await get.json()) as { name: string; description: string; latest_revision_id: string | null };
    expect(skill.name).toBe('demo-skill');
    expect(skill.description).toBe('Manages X. Use when Y.');
    expect(skill.latest_revision_id).toMatch(/^rev_/);

    const revs = await app.request('/v1/skills/demo-skill/revisions');
    expect(((await revs.json()) as { revisions: unknown[] }).revisions).toHaveLength(1);
  });

  it('rejects invalid payloads at the boundary (400, no operation)', async () => {
    app = makeApp();
    // no SKILL.md
    const noSkill = await buildZipBase64([{ path: 'readme.md', content: 'hi' }]);
    expect((await postSkill(app, 'a-skill', noSkill)).status).toBe(400);
    // SKILL.md without description
    const noDesc = await buildZipBase64([{ path: 'SKILL.md', content: '---\nname: a-skill\n---\n' }]);
    expect((await postSkill(app, 'a-skill', noDesc)).status).toBe(400);
    // secret in a script
    const withSecret = await buildZipBase64([
      { path: 'SKILL.md', content: skillMd('a-skill') },
      { path: 'scripts/x.sh', content: 'token=ghp_0123456789abcdefghij0123456789abcdAB\n' },
    ]);
    const sres = await postSkill(app, 'a-skill', withSecret);
    expect(sres.status).toBe(400);
    expect((await sres.json()) as { error: string }).toMatchObject({ error: 'secret_detected' });
  });

  it('lists with pagination and deletes with id reservation', async () => {
    app = makeApp();
    for (const id of ['p-one', 'p-two']) {
      const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd(id) }]);
      const r = await postSkill(app, id, zip);
      await pollDone(app, ((await r.json()) as { operation_id: string }).operation_id);
    }
    const list = await app.request('/v1/skills?page_size=1');
    const body = (await list.json()) as { skills: { skill_id: string }[]; next_page_token: string | null };
    expect(body.skills).toHaveLength(1);
    expect(body.next_page_token).toBe('p-one');

    const del = await app.request('/v1/skills/p-one', { method: 'DELETE' });
    expect(del.status).toBe(202);
    await pollDone(app, ((await del.json()) as { operation_id: string }).operation_id);
    expect((await app.request('/v1/skills/p-one')).status).toBe(404);
    // recreate within reservation window → 409 reserved
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('p-one') }]);
    const recreate = await postSkill(app, 'p-one', zip);
    expect(recreate.status).toBe(409);
    expect((await recreate.json()) as { error: string }).toMatchObject({ error: 'reserved' });
  });

  it('updateMask: metadata-only and payload (new revision)', async () => {
    app = makeApp();
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('u-skill') }]);
    await pollDone(app, ((await (await postSkill(app, 'u-skill', zip)).json()) as { operation_id: string }).operation_id);

    // metadata-only update (no new revision)
    const metaRes = await app.request('/v1/skills/u-skill?updateMask=description', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'changed' }),
    });
    expect(metaRes.status).toBe(202);
    await pollDone(app, ((await metaRes.json()) as { operation_id: string }).operation_id);
    expect(((await (await app.request('/v1/skills/u-skill')).json()) as { description: string }).description).toBe('changed');
    expect((((await (await app.request('/v1/skills/u-skill/revisions')).json()) as { revisions: unknown[] }).revisions)).toHaveLength(1);

    // payload update → new revision
    const zip2 = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('u-skill', 'v2 desc') }]);
    const payRes = await app.request('/v1/skills/u-skill?updateMask=zippedFilesystem', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zippedFilesystem: zip2 }),
    });
    expect(payRes.status).toBe(202);
    await pollDone(app, ((await payRes.json()) as { operation_id: string }).operation_id);
    expect((((await (await app.request('/v1/skills/u-skill/revisions')).json()) as { revisions: unknown[] }).revisions)).toHaveLength(2);
  });

  it('concurrent POST same skill_id: exactly one done, the rest failed', async () => {
    app = makeApp();
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('race-skill') }]);
    const N = 6;
    const creates = await Promise.all(Array.from({ length: N }, async () => postSkill(app, 'race-skill', zip)));
    // some may 409 synchronously (TOCTOU loser); accepted ones get an operation
    const opIds: string[] = [];
    for (const r of creates) {
      if (r.status === 202) {
        opIds.push(((await r.json()) as { operation_id: string }).operation_id);
      }
    }
    const states = await Promise.all(
      opIds.map(async (opId) => {
        for (let i = 0; i < 200; i++) {
          const op = (await (await app.request(`/v1/operations/${opId}`)).json()) as OpBody;
          if (op.state === 'ACTIVE' || op.state === 'FAILED') {
            return op.state;
          }
          await sleep(50);
        }
        throw new Error('not terminal');
      }),
    );
    expect(states.filter((s) => s === 'ACTIVE')).toHaveLength(1);
    const skillCount = await getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM skills WHERE skill_id = 'race-skill'",
    );
    expect(skillCount.rows[0]?.count).toBe('1');
    // no orphan revision: exactly one revision for the single winning skill
    const revCount = await getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM skill_revisions WHERE skill_id = 'race-skill'",
    );
    expect(revCount.rows[0]?.count).toBe('1');
  });

  it('GET revision by id returns the revision; unknown/cross-skill → 404 (T4.4)', async () => {
    app = makeApp();
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('rev-skill') }]);
    await pollDone(app, ((await (await postSkill(app, 'rev-skill', zip)).json()) as { operation_id: string }).operation_id);

    const list = (await (await app.request('/v1/skills/rev-skill/revisions')).json()) as {
      revisions: { revision_id: string }[];
    };
    const revId = list.revisions[0]?.revision_id as string;
    const ok = await app.request(`/v1/skills/rev-skill/revisions/${revId}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { revision_id: string }).revision_id).toBe(revId);

    expect((await app.request('/v1/skills/rev-skill/revisions/rev_nope')).status).toBe(404);
    // valid revision id under the WRONG skill id → 404 (cross-skill guard)
    const otherZip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('other-skill') }]);
    await pollDone(app, ((await (await postSkill(app, 'other-skill', otherZip)).json()) as { operation_id: string }).operation_id);
    expect((await app.request(`/v1/skills/other-skill/revisions/${revId}`)).status).toBe(404);
  });

  it('concurrent PATCH with payloads converges to a consistent latest_revision_id (T4.3)', async () => {
    app = makeApp();
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('cu-skill') }]);
    await pollDone(app, ((await (await postSkill(app, 'cu-skill', zip)).json()) as { operation_id: string }).operation_id);

    const patch = async (desc: string): Promise<string> => {
      const z = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('cu-skill', desc) }]);
      const r = await app.request('/v1/skills/cu-skill?updateMask=zippedFilesystem', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ zippedFilesystem: z }),
      });
      return ((await r.json()) as { operation_id: string }).operation_id;
    };
    const ops = await Promise.all([patch('v-a'), patch('v-b')]);
    await Promise.all(ops.map((op) => pollDone(app, op)));

    // 1 initial + 2 update revisions; latest points at exactly one real revision
    const revs = (await (await app.request('/v1/skills/cu-skill/revisions')).json()) as {
      revisions: { revision_id: string }[];
    };
    expect(revs.revisions).toHaveLength(3);
    const latest = ((await (await app.request('/v1/skills/cu-skill')).json()) as { latest_revision_id: string })
      .latest_revision_id;
    expect(revs.revisions.map((r) => r.revision_id)).toContain(latest);
  });

  it('rejects an oversized body with 413 (DoS guard)', async () => {
    const tiny = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), reservationHours: 1, maxBodyBytes: 64 });
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('big-skill') }]);
    const res = await postSkill(tiny, 'big-skill', zip);
    expect(res.status).toBe(413);
  });
});
