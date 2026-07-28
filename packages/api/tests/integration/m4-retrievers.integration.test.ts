import { createId } from '@paralleldrive/cuid2';
import { createKeywordRetriever, createStubEmbedder, createVectorRetriever, RetrieverError, stubEmbed } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const executor = () => createPgExecutor(getPool());

/** Seed a skill with a current revision + its embedding + maintained search_text. */
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

describeIntegration('M4 vector + keyword retrievers (T2.2/T2.3)', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('vector retriever orders skills by cosine similarity to the query', async () => {
    await seed('vr-pdf', 'PDF Summarizer', 'condenses documents', 'extracts and condenses financial pdfs');
    await seed('vr-img', 'Image Resizer', 'scales images', 'resizes png and jpeg files');
    const r = createVectorRetriever({ executor: executor(), embedder: createStubEmbedder() });
    // query == the exact PDF search_text → that skill is the nearest (stub is deterministic)
    const out = await r.retrieve({ query: 'PDF Summarizer condenses documents extracts and condenses financial pdfs', topK: 2 });
    expect(out[0]?.skill_id).toBe('vr-pdf');
    expect(out[0]?.score).toBeGreaterThan(out[1]?.score ?? 1);
    expect(out[0]).toMatchObject({ name: 'PDF Summarizer' });
  });

  it('keyword retriever ranks by ts_rank and matches by lexical content', async () => {
    await seed('kw-pdf', 'PDF Summarizer', 'condenses documents', 'extracts and condenses financial pdfs');
    await seed('kw-img', 'Image Resizer', 'scales images', 'resizes png and jpeg files');
    const r = createKeywordRetriever({ executor: executor() });
    const out = await r.retrieve({ query: 'financial pdf', topK: 5 });
    expect(out.map((x) => x.skill_id)).toContain('kw-pdf');
    expect(out.map((x) => x.skill_id)).not.toContain('kw-img'); // no lexical overlap
    expect(out[0]?.score).toBeGreaterThan(0);
  });

  it('keyword retriever handles multi-word / operator input without throwing', async () => {
    await seed('kw-x', 'Thing', 'does stuff', 'alpha beta gamma');
    const r = createKeywordRetriever({ executor: executor() });
    for (const q of ['alpha beta', '"alpha beta"', 'alpha or beta', 'alpha -beta', 'foo & (']) {
      await expect(r.retrieve({ query: q, topK: 5 }), q).resolves.toBeInstanceOf(Array);
    }
  });

  it('vector retriever excludes soft-deleted skills', async () => {
    await seed('vr-del', 'Deletable', 'gone soon', 'to be removed');
    await getPool().query(`UPDATE skills SET deleted_at = now() WHERE skill_id = 'vr-del'`);
    const r = createVectorRetriever({ executor: executor(), embedder: createStubEmbedder() });
    const out = await r.retrieve({ query: 'anything', topK: 5 });
    expect(out.map((x) => x.skill_id)).not.toContain('vr-del');
  });

  it('keyword retriever matches on ANY overlapping term (OR semantics, not AND)', async () => {
    await seed('kw-or', 'Widget', 'does things', 'alpha beta gamma');
    const r = createKeywordRetriever({ executor: executor() });
    // query shares only "alpha" with the skill; the other term has no match — AND would miss it.
    const out = await r.retrieve({ query: 'alpha zzznomatchword', topK: 5 });
    expect(out.map((x) => x.skill_id)).toContain('kw-or');
  });

  it('keyword retriever returns [] for an all-stopword query (empty tsquery, no throw)', async () => {
    await seed('kw-stop', 'Thing', 'does stuff', 'alpha beta');
    const r = createKeywordRetriever({ executor: executor() });
    await expect(r.retrieve({ query: 'the a of an', topK: 5 })).resolves.toEqual([]);
  });

  it('vector retriever throws (typed) on a dimension mismatch, before any SQL', async () => {
    await seed('vr-dim', 'Dim', 'dim test', 'body');
    const wrongDim = createStubEmbedder({ dimensions: 768 });
    const r = createVectorRetriever({ executor: executor(), embedder: wrongDim });
    await expect(r.retrieve({ query: 'x', topK: 5 })).rejects.toThrow(/dimension/i);
  });

  it('wraps an executor failure in RetrieverError (no raw pg error leak)', async () => {
    const boom = { query: () => Promise.reject(new Error('connection reset; SQL: SELECT secret')) };
    const r = createKeywordRetriever({ executor: boom });
    await expect(r.retrieve({ query: 'x', topK: 5 })).rejects.toBeInstanceOf(RetrieverError);
  });
});
