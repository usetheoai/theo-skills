import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, EMBEDDING_DIM, type EmbeddingProvider, DEFAULT_WORKSPACE_ID }  from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createEmbedSkillHandler } from '../../src/server/embed/embed-worker.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createEmbeddingsStore } from '../../src/server/store/embeddings-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const store = () => createEmbeddingsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);

async function seedSkill(skillId: string, body = '# body'): Promise<string> {
  const revisionId = `rev_${createId()}`;
  await getPool().query(`INSERT INTO skills (skill_id, name, description, latest_revision_id) VALUES ($1, $2, $3, $4)`, [
    skillId,
    `Name ${skillId}`,
    `Description for ${skillId}`,
    revisionId,
  ]);
  await getPool().query(
    `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1, $2, '\\x00', 'h', '{}'::jsonb, $3)`,
    [revisionId, skillId, body],
  );
  return revisionId;
}

/** Embedder that always returns the wrong dimension (to test the guard). */
const badDimEmbedder: EmbeddingProvider = {
  provider: 'stub',
  model: 'bad',
  embed: () => Promise.resolve(new Array<number>(EMBEDDING_DIM - 1).fill(0)),
  embedBatch: (texts) => Promise.resolve(texts.map(() => new Array<number>(EMBEDDING_DIM - 1).fill(0))),
};

describeIntegration('M3 embed worker: generate + guard + idempotent upsert (T3.3/T3.4)', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('writes a queryable embedding for the current revision', async () => {
    const rev = await seedSkill('embed-ok');
    const handler = createEmbedSkillHandler({ embeddingsStoreFor: () => store(), embedder: createStubEmbedder(), logger: createNoopLogger() });
    await handler({ skill_id: 'embed-ok', revision_id: rev });

    const rows = await store().listByRevision(rev);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('stub');
    expect(rows[0]?.dimensions).toBe(EMBEDDING_DIM);
    // vector customType round-trip (Drizzle fromDriver) yields a real number[] of the right size
    expect(rows[0]?.vector).toHaveLength(EMBEDDING_DIM);
    expect(typeof rows[0]?.vector[0]).toBe('number');

    // queryable by cosine
    const q = await getPool().query<{ score: string }>(
      `SELECT 1 - (vector <=> (SELECT vector FROM embeddings WHERE revision_id = $1)) AS score
       FROM embeddings WHERE revision_id = $1`,
      [rev],
    );
    expect(Number(q.rows[0]?.score)).toBeCloseTo(1.0, 5);
  });

  it('rejects a dimension mismatch (fail-fast, no row written)', async () => {
    const revBad = await seedSkill('embed-bad');
    const handler = createEmbedSkillHandler({ embeddingsStoreFor: () => store(), embedder: badDimEmbedder, logger: createNoopLogger() });
    await expect(handler({ skill_id: 'embed-bad', revision_id: revBad })).rejects.toThrow();
    const count = await getPool().query<{ count: string }>("SELECT count(*)::text AS count FROM embeddings");
    expect(count.rows[0]?.count).toBe('0'); // nothing corrupt persisted
  });

  it('is a no-op for a missing / soft-deleted skill', async () => {
    const handler = createEmbedSkillHandler({ embeddingsStoreFor: () => store(), embedder: createStubEmbedder(), logger: createNoopLogger() });
    await handler({ skill_id: 'does-not-exist', revision_id: 'rev_nope' }); // must not throw
    const count = await getPool().query<{ count: string }>("SELECT count(*)::text AS count FROM embeddings");
    expect(count.rows[0]?.count).toBe('0');
  });

  it('re-embedding the same revision is idempotent (one row)', async () => {
    const rev = await seedSkill('embed-idem');
    const handler = createEmbedSkillHandler({ embeddingsStoreFor: () => store(), embedder: createStubEmbedder(), logger: createNoopLogger() });
    await handler({ skill_id: 'embed-idem', revision_id: rev });
    await handler({ skill_id: 'embed-idem', revision_id: rev });
    expect(await store().listByRevision(rev)).toHaveLength(1);
  });

  it('Concurrent test: two parallel embed jobs for the same revision resolve to one row', async () => {
    const rev = await seedSkill('embed-race');
    const handler = createEmbedSkillHandler({ embeddingsStoreFor: () => store(), embedder: createStubEmbedder(), logger: createNoopLogger() });
    await Promise.all([handler({ skill_id: 'embed-race', revision_id: rev }), handler({ skill_id: 'embed-race', revision_id: rev })]);
    expect(await store().listByRevision(rev)).toHaveLength(1); // unique + ON CONFLICT
  });
});
