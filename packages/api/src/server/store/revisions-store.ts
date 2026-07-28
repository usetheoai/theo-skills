import { skillRevisions } from '@usetheo/skills/db';
import { desc, eq } from 'drizzle-orm';

import { type Db } from '../db.js';

/** Public revision metadata (the payload is fetched on demand, not listed). */
export interface RevisionView {
  readonly revision_id: string;
  readonly skill_id: string;
  readonly content_hash: string;
  readonly create_time: string;
}

export interface RevisionsStore {
  /** Revisions of a skill, most recent first. */
  listBySkill(skillId: string): Promise<RevisionView[]>;
  /** A single revision by id (metadata). */
  getById(revisionId: string): Promise<RevisionView | undefined>;
}

function toView(row: {
  revisionId: string;
  skillId: string;
  contentHash: string;
  createTime: Date;
}): RevisionView {
  return {
    revision_id: row.revisionId,
    skill_id: row.skillId,
    content_hash: row.contentHash,
    create_time: row.createTime.toISOString(),
  };
}

export function createRevisionsStore(db: Db): RevisionsStore {
  return {
    async listBySkill(skillId) {
      const rows = await db
        .select({
          revisionId: skillRevisions.revisionId,
          skillId: skillRevisions.skillId,
          contentHash: skillRevisions.contentHash,
          createTime: skillRevisions.createTime,
        })
        .from(skillRevisions)
        .where(eq(skillRevisions.skillId, skillId))
        .orderBy(desc(skillRevisions.createTime), desc(skillRevisions.revisionId));
      return rows.map(toView);
    },

    async getById(revisionId) {
      const rows = await db
        .select({
          revisionId: skillRevisions.revisionId,
          skillId: skillRevisions.skillId,
          contentHash: skillRevisions.contentHash,
          createTime: skillRevisions.createTime,
        })
        .from(skillRevisions)
        .where(eq(skillRevisions.revisionId, revisionId))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toView(row);
    },
  };
}
