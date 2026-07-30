import { type EmbeddingRow, embeddings, skillRevisions, skills } from '@usetheo/skills/db';
import { and, eq, isNull } from 'drizzle-orm';

import { type Db } from '../db.js';

/** Text source for an embedding: the skill's current name/description + body. */
export interface EmbedSource {
  readonly revisionId: string;
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly skillMd: string;
}

export interface NewEmbedding {
  readonly id: string;
  readonly revisionId: string;
  readonly skillId: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly vector: number[];
}

export interface EmbeddingsStore {
  /**
   * Resolve the embedding source for the skill's CURRENT revision (the one
   * `skills.latest_revision_id` points at). Returns undefined when the skill is
   * absent, soft-deleted, or has no revision yet. Used at ENQUEUE time to capture
   * which revision to embed.
   */
  getEmbedSourceBySkill(skillId: string): Promise<EmbedSource | undefined>;
  /**
   * Resolve the embedding source for a SPECIFIC revision (used by the worker so
   * the embedded revision is exactly the one captured at enqueue — no run-time
   * latest-revision race). Returns undefined if the revision/skill is gone or
   * soft-deleted.
   */
  getEmbedSourceByRevision(revisionId: string): Promise<EmbedSource | undefined>;
  /** Idempotent upsert — first writer per (revision, provider, model) wins. */
  upsert(input: NewEmbedding): Promise<void>;
  /** Embeddings for a revision (test/query helper). */
  listByRevision(revisionId: string): Promise<EmbeddingRow[]>;
}

export function createEmbeddingsStore(db: Db, workspaceId: string): EmbeddingsStore {
  return {
    async getEmbedSourceBySkill(skillId) {
      const rows = await db
        .select({
          revisionId: skillRevisions.revisionId,
          skillId: skills.skillId,
          name: skills.name,
          description: skills.description,
          skillMd: skillRevisions.skillMd,
        })
        .from(skills)
        .innerJoin(skillRevisions, eq(skillRevisions.revisionId, skills.latestRevisionId))
        .where(
          and(
            eq(skills.workspaceId, workspaceId),
            eq(skills.skillId, skillId),
            isNull(skills.deletedAt),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async getEmbedSourceByRevision(revisionId) {
      const rows = await db
        .select({
          revisionId: skillRevisions.revisionId,
          skillId: skills.skillId,
          name: skills.name,
          description: skills.description,
          skillMd: skillRevisions.skillMd,
        })
        .from(skillRevisions)
        .innerJoin(skills, eq(skills.skillId, skillRevisions.skillId))
        .where(
          and(
            eq(skillRevisions.workspaceId, workspaceId),
            eq(skillRevisions.revisionId, revisionId),
            isNull(skills.deletedAt),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async upsert(input) {
      // pgvector literal `[a,b,c]`; ON CONFLICT DO NOTHING makes re-embeds idempotent.
      await db
        .insert(embeddings)
        .values({
          id: input.id,
          revisionId: input.revisionId,
          skillId: input.skillId,
          provider: input.provider,
          model: input.model,
          dimensions: input.dimensions,
          vector: input.vector,
        })
        .onConflictDoNothing({
          target: [embeddings.revisionId, embeddings.provider, embeddings.model],
        });
    },

    async listByRevision(revisionId) {
      return db
        .select()
        .from(embeddings)
        .where(
          and(eq(embeddings.workspaceId, workspaceId), eq(embeddings.revisionId, revisionId)),
        );
    },
  } satisfies EmbeddingsStore;
}

/** Build the embedding source text from a resolved source. */
export function embedSourceText(src: EmbedSource): string {
  return `${src.name}\n${src.description}\n${src.skillMd}`;
}
