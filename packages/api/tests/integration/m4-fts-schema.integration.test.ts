import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const newRev = (skillId: string, name: string, description: string, body: string) => ({
  skillId,
  name,
  description,
  payload: Buffer.from('z'),
  contentHash: 'h-' + skillId,
  frontmatter: {},
  skillMd: body,
});

async function searchTextOf(skillId: string): Promise<string> {
  const r = await getPool().query<{ search_text: string }>('SELECT search_text FROM skills WHERE skill_id = $1', [skillId]);
  return r.rows[0]?.search_text ?? '';
}

describeIntegration('M4 FTS schema + search_text maintenance (T1.1/T1.2)', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('has the GIN index + a generated tsvector that answers websearch queries', async () => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision(newRev('fts-skill', 'PDF Summarizer', 'condenses documents', '# extracts and condenses financial pdfs'));

    const idx = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'skills' AND indexname = 'skills_search_tsv_gin'`,
    );
    expect(idx.rows[0]?.indexdef).toMatch(/USING gin/i);

    const hit = await getPool().query<{ skill_id: string }>(
      `SELECT skill_id FROM skills WHERE search_tsv @@ websearch_to_tsquery('english', $1)`,
      ['financial documents'],
    );
    expect(hit.rows.map((r) => r.skill_id)).toContain('fts-skill');
  });

  it('search_text = name + description + body on create', async () => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision(newRev('s1', 'Alpha', 'does alpha', '# alpha body'));
    expect(await searchTextOf('s1')).toBe('Alpha does alpha # alpha body');
  });

  it('a metadata-only update refreshes search_text (no new revision)', async () => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision(newRev('s2', 'Beta', 'old desc', '# beta body'));
    await store.updateMetadata('s2', { description: 'new shiny description' });
    const txt = await searchTextOf('s2');
    expect(txt).toBe('Beta new shiny description # beta body'); // body preserved, desc refreshed
  });

  it('adding a revision refreshes search_text with the new body', async () => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision(newRev('s3', 'Gamma', 'desc', '# old body'));
    await store.addRevision('s3', { payload: Buffer.from('z2'), contentHash: 'h2', frontmatter: {}, skillMd: '# new body v2' });
    expect(await searchTextOf('s3')).toBe('Gamma desc # new body v2');
  });

  it('recycling a tombstoned id rebuilds search_text with the NEW content (no stale tokens)', async () => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision(newRev('recyc', 'oldname', 'old description', '# unique-old-token'));
    // soft-delete with an already-expired reservation so the id is immediately recyclable
    await getPool().query(`UPDATE skills SET deleted_at = now(), reserved_until = now() - interval '1 hour' WHERE skill_id = 'recyc'`);
    await store.createWithRevision(newRev('recyc', 'newname', 'new description', '# fresh-new-token'));
    const txt = await searchTextOf('recyc');
    expect(txt).toBe('newname new description # fresh-new-token');
    expect(txt).not.toContain('unique-old-token'); // no contamination from the purged skill
  });
});
