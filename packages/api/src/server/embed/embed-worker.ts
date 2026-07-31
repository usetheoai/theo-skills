import { createId } from '@paralleldrive/cuid2';
import { assertEmbeddingDim, type EmbeddingProvider } from '@usetheo/skills';
import type PgBoss from 'pg-boss';

import { type Logger } from '../logger.js';
import {
  type EmbedSkillJobData,
  EMBED_SKILL_DLQ_QUEUE_NAME,
  EMBED_SKILL_SEND_OPTIONS,
  EMBED_SKILL_SINGLETON_SECONDS,
  JOB_NAMES,
} from '../queue/queue.js';
import { type EmbeddingsStore, embedSourceText } from '../store/embeddings-store.js';
import { type OnOperationTerminal } from '../worker.js';

export interface EmbedWorkerDeps {
  readonly embeddingsStore: EmbeddingsStore;
  readonly embedder: EmbeddingProvider;
  readonly logger: Logger;
}

export type EmbedSkillHandler = (data: EmbedSkillJobData) => Promise<void>;

/**
 * Embed the skill's CURRENT revision: resolve source text (name + description +
 * SKILL.md body), generate the vector, guard the dimension (fail-fast — never
 * write a corrupt vector), and idempotently upsert it. A skill that was deleted
 * or has no revision is a no-op (nothing to index).
 */
export function createEmbedSkillHandler(deps: EmbedWorkerDeps): EmbedSkillHandler {
  return async (data) => {
    const source = await deps.embeddingsStore.getEmbedSourceByRevision(data.revision_id);
    if (source === undefined) {
      return; // revision/skill gone / soft-deleted — nothing to embed
    }
    const vector = await deps.embedder.embed(embedSourceText(source));
    assertEmbeddingDim(vector); // fail-fast: a provider that diverges throws, no write

    await deps.embeddingsStore.upsert({
      id: `emb_${createId()}`,
      revisionId: source.revisionId,
      skillId: source.skillId,
      provider: deps.embedder.provider,
      model: deps.embedder.model,
      dimensions: vector.length,
      vector,
    });
    deps.logger.info(
      { skill_id: data.skill_id, revision_id: source.revisionId, provider: deps.embedder.provider },
      'skill embedded',
    );
  };
}

/**
 * Build the `onTerminal` hook that enqueues an embed job when a skill is created
 * or updated successfully. Deletes and failures are skipped (nothing to index).
 * The current revision is captured AT ENQUEUE TIME and the job is singleton-keyed
 * by `revision_id`, so (a) each revision is embedded exactly once even under
 * retries/double-fire, and (b) an update never dedups its NEW revision against
 * the previous one (every revision gets indexed — closes the dedup-skips-revision gap).
 */
export function createEmbedEnqueuer(deps: {
  queue: PgBoss;
  embeddingsStore: EmbeddingsStore;
  logger: Logger;
}): OnOperationTerminal {
  return async ({ skillId, eventType, state }) => {
    if (state !== 'ACTIVE' || eventType === 'skill.deleted') {
      return;
    }
    const source = await deps.embeddingsStore.getEmbedSourceBySkill(skillId);
    if (source === undefined) {
      return; // no current revision to embed
    }
    const jobData: EmbedSkillJobData = { skill_id: skillId, revision_id: source.revisionId };
    await deps.queue.send(JOB_NAMES.EMBED_SKILL, jobData, {
      ...EMBED_SKILL_SEND_OPTIONS,
      singletonKey: source.revisionId,
      singletonSeconds: EMBED_SKILL_SINGLETON_SECONDS,
    });
  };
}

export interface RegisterEmbedWorkerDeps {
  readonly queue: PgBoss;
  readonly handler: EmbedSkillHandler;
  readonly logger: Logger;
}

/**
 * Register the embed_skill consumer + its dead-letter consumer. The DLQ handler
 * makes a permanently-failing embed OBSERVABLE (e.g. a mis-dimensioned provider):
 * the skill is recoverable via re-PATCH, but the failure must not be silent.
 */
export async function registerEmbedWorker(deps: RegisterEmbedWorkerDeps): Promise<void> {
  await deps.queue.work<EmbedSkillJobData>(
    JOB_NAMES.EMBED_SKILL,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await deps.handler(job.data);
      }
    },
  );
  await deps.queue.work<EmbedSkillJobData>(
    EMBED_SKILL_DLQ_QUEUE_NAME,
    { pollingIntervalSeconds: 2 },
    (jobs) => {
      for (const job of jobs) {
        deps.logger.error({ skill_id: job.data.skill_id }, 'embed_skill dead-lettered (retries exhausted) — skill has no embedding');
      }
      return Promise.resolve();
    },
  );
}
