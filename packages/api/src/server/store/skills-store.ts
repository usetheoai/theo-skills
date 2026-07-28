import { createId } from '@paralleldrive/cuid2';
import { skillRevisions, skills } from '@usetheo/skills/db';
import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { type Db } from '../db.js';
import { isUniqueViolation, SkillAlreadyExistsError } from '../persistence/pg-errors.js';

/** Public skill view (excludes soft-deleted skills). */
export interface SkillView {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  readonly latest_revision_id: string | null;
  readonly create_time: string;
  readonly update_time: string;
}

export interface NewSkillRevision {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly payload: Buffer;
  readonly contentHash: string;
  readonly frontmatter: Record<string, unknown>;
  /** M3: SKILL.md markdown text — embedding source captured at ingest. */
  readonly skillMd: string;
}

export interface RevisionPayload {
  readonly payload: Buffer;
  readonly contentHash: string;
  readonly frontmatter: Record<string, unknown>;
  /** M3: SKILL.md markdown text — embedding source captured at ingest. */
  readonly skillMd: string;
}

export interface ListPage {
  readonly skills: SkillView[];
  readonly nextPageToken: string | null;
}

export interface SkillsStore {
  /** Atomic create: insert the skill + its first revision; set latest pointer. */
  createWithRevision(input: NewSkillRevision): Promise<void>;
  /** Append a new immutable revision and move the latest pointer (atomic). */
  addRevision(skillId: string, rev: RevisionPayload): Promise<string>;
  /** Update mutable metadata fields (updateMask). */
  updateMetadata(skillId: string, fields: { name?: string; description?: string }): Promise<void>;
  /** Fetch a live (non-deleted) skill view, or undefined. */
  getView(skillId: string): Promise<SkillView | undefined>;
  /** Keyset-paginated list of live skills (ordered by skill_id). */
  listPaginated(pageSize: number, pageToken: string | null): Promise<ListPage>;
  /** Soft-delete: mark DELETED + reserved_until. Returns whether it existed. */
  softDelete(skillId: string, reservedUntil: Date): Promise<boolean>;
  /** True when the id currently has a non-expired post-delete reservation. */
  isReserved(skillId: string): Promise<boolean>;
}

function toView(row: {
  skillId: string;
  name: string;
  description: string;
  state: string;
  latestRevisionId: string | null;
  createTime: Date;
  updateTime: Date;
}): SkillView {
  return {
    skill_id: row.skillId,
    name: row.name,
    description: row.description,
    state: row.state,
    latest_revision_id: row.latestRevisionId,
    create_time: row.createTime.toISOString(),
    update_time: row.updateTime.toISOString(),
  };
}

const liveColumns = {
  skillId: skills.skillId,
  name: skills.name,
  description: skills.description,
  state: skills.state,
  latestRevisionId: skills.latestRevisionId,
  createTime: skills.createTime,
  updateTime: skills.updateTime,
};

/**
 * Rebuild `skills.search_text` (M4 FTS source) from the skill's CURRENT
 * name + description + latest-revision SKILL.md body. Run inside the same write
 * so the lexical index is always consistent — including metadata-only updates
 * that do not create a new revision.
 */
function refreshSearchText(executor: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, skillId: string): Promise<unknown> {
  return executor.execute(sql`
    UPDATE skills s
    SET search_text = s.name || ' ' || s.description || ' ' || coalesce(r.skill_md, '')
    FROM skill_revisions r
    WHERE r.revision_id = s.latest_revision_id AND s.skill_id = ${skillId}
  `);
}

export function createSkillsStore(db: Db): SkillsStore {
  return {
    async createWithRevision(input) {
      const revisionId = `rev_${createId()}`;
      await db.transaction(async (tx) => {
        // Free an EXPIRED post-delete tombstone so the id can be recycled (the
        // reservation window having elapsed). A live skill or a still-reserved id
        // does not match here, so the insert below conflicts → typed error.
        const purged = await tx
          .delete(skills)
          .where(
            and(
              eq(skills.skillId, input.skillId),
              isNotNull(skills.deletedAt),
              lt(skills.reservedUntil, sql`now()`),
            ),
          )
          .returning({ skillId: skills.skillId });
        if (purged.length > 0) {
          await tx.delete(skillRevisions).where(eq(skillRevisions.skillId, input.skillId));
        }
        try {
          await tx.insert(skills).values({
            skillId: input.skillId,
            name: input.name,
            description: input.description,
            state: 'ACTIVE',
            latestRevisionId: revisionId,
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new SkillAlreadyExistsError(input.skillId);
          }
          throw err;
        }
        await tx.insert(skillRevisions).values({
          revisionId,
          skillId: input.skillId,
          payload: input.payload,
          contentHash: input.contentHash,
          frontmatter: input.frontmatter,
          skillMd: input.skillMd,
        });
        await refreshSearchText(tx, input.skillId);
      });
    },

    async addRevision(skillId, rev) {
      const revisionId = `rev_${createId()}`;
      await db.transaction(async (tx) => {
        await tx.insert(skillRevisions).values({
          revisionId,
          skillId,
          payload: rev.payload,
          contentHash: rev.contentHash,
          frontmatter: rev.frontmatter,
          skillMd: rev.skillMd,
        });
        await tx
          .update(skills)
          .set({ latestRevisionId: revisionId, updateTime: new Date() })
          .where(eq(skills.skillId, skillId));
        await refreshSearchText(tx, skillId);
      });
      return revisionId;
    },

    async updateMetadata(skillId, fields) {
      const patch: Record<string, unknown> = { updateTime: new Date() };
      if (fields.name !== undefined) {
        patch['name'] = fields.name;
      }
      if (fields.description !== undefined) {
        patch['description'] = fields.description;
      }
      await db.transaction(async (tx) => {
        await tx.update(skills).set(patch).where(eq(skills.skillId, skillId));
        await refreshSearchText(tx, skillId);
      });
    },

    async getView(skillId) {
      const rows = await db
        .select(liveColumns)
        .from(skills)
        .where(and(eq(skills.skillId, skillId), isNull(skills.deletedAt)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toView(row);
    },

    async listPaginated(pageSize, pageToken) {
      const where =
        pageToken === null
          ? isNull(skills.deletedAt)
          : and(isNull(skills.deletedAt), gt(skills.skillId, pageToken));
      const rows = await db
        .select(liveColumns)
        .from(skills)
        .where(where)
        .orderBy(asc(skills.skillId))
        .limit(pageSize + 1);

      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      return {
        skills: page.map(toView),
        nextPageToken: hasMore ? (page[page.length - 1]?.skillId ?? null) : null,
      };
    },

    async softDelete(skillId, reservedUntil) {
      const result = await db
        .update(skills)
        .set({ state: 'DELETED', deletedAt: new Date(), reservedUntil, updateTime: new Date() })
        .where(and(eq(skills.skillId, skillId), isNull(skills.deletedAt)))
        .returning({ skillId: skills.skillId });
      return result.length > 0;
    },

    async isReserved(skillId) {
      const rows = await db
        .select({ skillId: skills.skillId })
        .from(skills)
        .where(
          and(
            eq(skills.skillId, skillId),
            isNotNull(skills.reservedUntil),
            gt(skills.reservedUntil, sql`now()`),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}
