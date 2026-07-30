import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { SkillAlreadyExistsError } from '../../src/server/persistence/pg-errors.js';
import { createOperationsStore } from '../../src/server/store/operations-store.js';
import { createRevisionsStore } from '../../src/server/store/revisions-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const newRev = (skillId: string, name = 'Demo') => ({
  skillId,
  name,
  description: 'desc',
  payload: Buffer.from(`zip-${createId()}`),
  contentHash: 'hash-' + skillId,
  frontmatter: { name, description: 'desc' },
  skillMd: `# ${name}\n\ndesc body`,
});

describeIntegration('skills + revisions stores (T3.2)', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('createWithRevision is atomic; getView and listBySkill reflect it', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const revisions = createRevisionsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision(newRev('demo'));

    const view = await skills.getView('demo');
    expect(view?.name).toBe('Demo');
    expect(view?.latest_revision_id).toMatch(/^rev_/);

    const revs = await revisions.listBySkill('demo');
    expect(revs).toHaveLength(1);
    expect(revs[0]?.content_hash).toBe('hash-demo');
  });

  it('addRevision appends an immutable revision and moves latest', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const revisions = createRevisionsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision(newRev('demo'));
    const first = (await skills.getView('demo'))?.latest_revision_id;

    const second = await skills.addRevision('demo', {
      payload: Buffer.from('zip2'),
      contentHash: 'hash2',
      frontmatter: { name: 'Demo', description: 'v2' },
      skillMd: '# Demo\n\nv2 body',
    });
    expect(second).not.toBe(first);
    expect((await skills.getView('demo'))?.latest_revision_id).toBe(second);
    // both revisions remain recoverable
    expect(await revisions.listBySkill('demo')).toHaveLength(2);
    expect(await revisions.getById(first as string)).toBeDefined();
  });

  it('duplicate createWithRevision maps to a typed error', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision(newRev('demo'));
    await expect(skills.createWithRevision(newRev('demo'))).rejects.toBeInstanceOf(SkillAlreadyExistsError);
  });

  it('updateMetadata changes only the given fields', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision(newRev('demo'));
    await skills.updateMetadata('demo', { description: 'updated' });
    const view = await skills.getView('demo');
    expect(view?.description).toBe('updated');
    expect(view?.name).toBe('Demo');
  });

  it('listPaginated is keyset-paginated and excludes deleted', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    for (const id of ['a-skill', 'b-skill', 'c-skill']) {
      await skills.createWithRevision(newRev(id));
    }
    const page1 = await skills.listPaginated(2, null);
    expect(page1.skills.map((s) => s.skill_id)).toEqual(['a-skill', 'b-skill']);
    expect(page1.nextPageToken).toBe('b-skill');
    const page2 = await skills.listPaginated(2, page1.nextPageToken);
    expect(page2.skills.map((s) => s.skill_id)).toEqual(['c-skill']);
    expect(page2.nextPageToken).toBeNull();
  });

  it('softDelete reserves the id within the configured window', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision(newRev('demo'));

    expect(await skills.softDelete('demo', new Date(Date.now() + 3600_000))).toBe(true);
    expect(await skills.getView('demo')).toBeUndefined(); // excluded after delete
    expect(await skills.isReserved('demo')).toBe(true);

    // a past reservation window is no longer reserved
    await skills.createWithRevision(newRev('other'));
    await skills.softDelete('other', new Date(Date.now() - 1000));
    expect(await skills.isReserved('other')).toBe(false);
  });

  it('an id can be recreated after the reservation window expires (was a BLOCKER)', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const revisions = createRevisionsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision(newRev('recyclable', 'First'));
    await skills.softDelete('recyclable', new Date(Date.now() - 1000)); // already expired
    expect(await skills.isReserved('recyclable')).toBe(false);

    // recreate must SUCCEED and start fresh (no stale revisions)
    await skills.createWithRevision(newRev('recyclable', 'Second'));
    const view = await skills.getView('recyclable');
    expect(view?.name).toBe('Second');
    expect(view?.state).toBe('ACTIVE');
    expect(await revisions.listBySkill('recyclable')).toHaveLength(1); // old revision purged

    // still blocked while a reservation is active
    await skills.createWithRevision(newRev('locked'));
    await skills.softDelete('locked', new Date(Date.now() + 3600_000));
    await expect(skills.createWithRevision(newRev('locked'))).rejects.toBeInstanceOf(SkillAlreadyExistsError);
  });

  it('concurrent createWithRevision same skill_id is a race resolved to one winner', async () => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const results = await Promise.allSettled([
      skills.createWithRevision(newRev('race', 'A')),
      skills.createWithRevision(newRev('race', 'B')),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const count = await getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM skills WHERE skill_id = 'race'",
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  // operations store (carried over from M0) still works
  it('operations store roundtrip and state transition', async () => {
    const ops = createOperationsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await ops.create({ operationId: 'op_1', skillId: 'demo', type: 'create_skill', initialState: 'CREATING' });
    expect((await ops.get('op_1'))?.state).toBe('CREATING');
    await ops.updateState('op_1', 'ACTIVE');
    expect((await ops.get('op_1'))?.state).toBe('ACTIVE');
  });
});
