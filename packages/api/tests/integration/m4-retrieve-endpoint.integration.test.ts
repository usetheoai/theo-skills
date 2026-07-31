import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, stubEmbed } from '@usetheo/skills';
import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { type Logger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

async function seed(skillId: string, name: string, description: string, body: string): Promise<void> {
  const revisionId = `rev_${createId()}`;
  const searchText = `${name} ${description} ${body}`;
  await getPool().query(
    `INSERT INTO skills (skill_id, name, description, latest_revision_id, search_text) VALUES ($1,$2,$3,$4,$5)`,
    [skillId, name, description, revisionId, searchText],
  );
  await getPool().query(
    `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1,$2,'\\x00','h','{}'::jsonb,$3)`,
    [revisionId, skillId, body],
  );
  const v = stubEmbed(searchText);
  await getPool().query(
    `INSERT INTO embeddings (id, revision_id, skill_id, provider, model, dimensions, vector)
     VALUES ($1,$2,$3,'stub','stub',1536,$4::vector)`,
    [`emb_${createId()}`, revisionId, skillId, `[${v.join(',')}]`],
  );
}

interface LogLine {
  fields: Record<string, unknown>;
  msg: string;
}
function capturingLogger(sink: LogLine[]): Logger {
  return {
    info: (fields, msg) => sink.push({ fields, msg }),
    error: () => undefined,
  };
}

const stubQueue = {} as unknown as PgBoss;

describeIntegration('M4 GET /v1/skills:retrieve endpoint + metric (T3.3/T3.4)', () => {
  let app: Hono<AppEnv>;
  const logs: LogLine[] = [];

  beforeEach(async () => {
    await truncateAll();
    logs.length = 0;
    app = createApp({ pool: getPool(), queue: stubQueue, logger: capturingLogger(logs), embedder: createStubEmbedder() });
  });
  afterAll(closePool);

  it('returns scored results for a hybrid query', async () => {
    await seed('ep-pdf', 'PDF Summarizer', 'condenses documents', 'extracts and condenses financial pdfs');
    await seed('ep-img', 'Image Resizer', 'scales images', 'resizes png and jpeg files');

    const res = await app.request('/v1/skills:retrieve?query=financial%20pdf%20documents&topK=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trace_id: string; results: { skill_id: string; score: number; name: string }[] };
    expect(body.trace_id).toMatch(/^trc_/);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.map((r) => r.skill_id)).toContain('ep-pdf');
    expect(typeof body.results[0]?.score).toBe('number'); // explicit score per result
    expect(body.results[0]).toHaveProperty('name');
  });

  it('emits a retrieve metric with latency_ms + top_score (north-star)', async () => {
    await seed('ep-m', 'Metric Skill', 'observable', 'metric body alpha');
    await app.request('/v1/skills:retrieve?query=alpha&strategy=keyword');
    const metric = logs.find((l) => l.msg === 'retrieve');
    expect(metric).toBeDefined();
    expect(typeof metric?.fields['latency_ms']).toBe('number');
    expect(metric?.fields).toHaveProperty('top_score');
    expect(metric?.fields['strategy']).toBe('keyword');
  });

  it('rejects an empty / missing query with 400', async () => {
    expect((await app.request('/v1/skills:retrieve?query=')).status).toBe(400);
    expect((await app.request('/v1/skills:retrieve')).status).toBe(400);
  });

  it('supports vector / keyword / hybrid strategies', async () => {
    await seed('ep-s', 'Strategy Skill', 'searchable', 'strategy body keyword match');
    for (const strategy of ['vector', 'keyword', 'hybrid']) {
      const res = await app.request(`/v1/skills:retrieve?query=keyword%20match&strategy=${strategy}`);
      expect(res.status, strategy).toBe(200);
    }
  });
});
