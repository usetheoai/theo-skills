import { createId } from '@paralleldrive/cuid2';
import { stubEmbed } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const toSql = (v: number[]): string => `[${v.join(',')}]`;

async function seedSkillRevision(skillId: string): Promise<string> {
  const revisionId = `rev_${createId()}`;
  await getPool().query(
    `INSERT INTO skills (skill_id, name, description) VALUES ($1, $2, '')`,
    [skillId, skillId],
  );
  await getPool().query(
    `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1, $2, '\\x00', 'h', '{}'::jsonb, $3)`,
    [revisionId, skillId, '# body text'],
  );
  return revisionId;
}

describeIntegration('M3 schema: pgvector embeddings table + HNSW index (T2.1)', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('accepts a 1536-dim vector and answers a cosine-distance query', async () => {
    const rev = await seedSkillRevision('vec-skill');
    const v = stubEmbed('hello world');
    expect(v).toHaveLength(1536);
    await getPool().query(
      `INSERT INTO embeddings (id, revision_id, skill_id, provider, model, dimensions, vector)
       VALUES ($1, $2, 'vec-skill', 'stub', 'stub', 1536, $3::vector)`,
      [`emb_${createId()}`, rev, toSql(v)],
    );

    const q = await getPool().query<{ score: string }>(
      `SELECT 1 - (vector <=> $1::vector) AS score FROM embeddings WHERE revision_id = $2`,
      [toSql(v), rev],
    );
    // self-similarity is exactly 1.0 for the stub (L2-normalized)
    expect(Number(q.rows[0]?.score)).toBeCloseTo(1.0, 5);
  });

  it('has the HNSW cosine index on embeddings.vector', async () => {
    const idx = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'embeddings' AND indexname = 'embeddings_vector_hnsw'`,
    );
    expect(idx.rows[0]?.indexdef).toMatch(/USING hnsw/i);
    expect(idx.rows[0]?.indexdef).toMatch(/vector_cosine_ops/i);
  });

  it('enforces unique (revision_id, provider, model)', async () => {
    const rev = await seedSkillRevision('uniq-skill');
    const v = stubEmbed('x');
    const ins = (): Promise<unknown> =>
      getPool().query(
        `INSERT INTO embeddings (id, revision_id, skill_id, provider, model, dimensions, vector)
         VALUES ($1, $2, 'uniq-skill', 'stub', 'stub', 1536, $3::vector)`,
        [`emb_${createId()}`, rev, toSql(v)],
      );
    await ins();
    await expect(ins()).rejects.toThrow(); // duplicate (revision, provider, model)
  });
});
