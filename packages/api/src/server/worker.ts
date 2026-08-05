import { NonRetriableOperationError, VersionRejectedError, type WebhookEventType, DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import type PgBoss from 'pg-boss';

import { type Logger } from './logger.js';
import { SkillAlreadyExistsError } from './persistence/pg-errors.js';
import {
  type CreateSkillJobData,
  type DeleteSkillJobData,
  JOB_NAMES,
  MAX_SKILL_RETRY,
  type UpdateSkillJobData,
} from './queue/queue.js';
import { type OperationsStore } from './store/operations-store.js';
import { type SkillsStore } from './store/skills-store.js';

/** Hook fired when an operation reaches a terminal state (wired to webhooks in T4.3). */
export type OnOperationTerminal = (args: {
  readonly operationId: string;
  readonly skillId: string;
  /**
   * Inquilino dono do trabalho (M11) — o worker já o resolve de `job.data.workspaceId`,
   * e ele PRECISA chegar aqui. Sem este campo, todo consumidor terminal (embedding,
   * webhook) tinha de escolher um workspace por conta própria, e a única escolha
   * disponível era o legado — silenciosamente errada para todo cliente real.
   */
  readonly workspaceId: string;
  /** M9: correlation id carried from the job so the webhook hop keeps the same trace. */
  readonly traceId: string;
  readonly eventType: WebhookEventType;
  readonly state: 'ACTIVE' | 'FAILED';
}) => Promise<void>;

/**
 * Inquilino dono do job.
 *
 * Jobs enfileirados ANTES do M11 não carregam o campo — pertencem ao workspace da ponte
 * legada. Sem este fallback, um job em voo no momento do deploy morreria com o inquilino
 * indefinido.
 */
function jobWorkspace(data: { readonly workspaceId?: string }): string {
  return data.workspaceId ?? DEFAULT_WORKSPACE_ID;
}

export interface WorkerDeps {
  /**
   * Factories escopadas por inquilino (M11).
   *
   * O worker roda fora de uma requisicao: o inquilino vem do PROPRIO job
   * (`job.data.workspaceId`), nao de um contexto HTTP. Receber uma instancia pronta faria
   * todo job escrever no mesmo workspace — vazamento silencioso entre clientes.
   */
  readonly skillsStoreFor: (workspaceId: string) => SkillsStore;
  readonly operationsStoreFor: (workspaceId: string) => OperationsStore;
  readonly logger: Logger;
  readonly onTerminal?: OnOperationTerminal;
}

/** Compose several terminal hooks into one (run sequentially, in order). */
export function composeTerminalHooks(...hooks: OnOperationTerminal[]): OnOperationTerminal {
  return async (args) => {
    for (const hook of hooks) {
      await hook(args);
    }
  };
}

function isBusinessRule(err: unknown): boolean {
  // `VersionRejectedError` é regra de negócio, não falha transitória: republicar `1.2.0` vai
  // ser recusado na décima tentativa exatamente como na primeira. Sem isto o job entraria em
  // retry com backoff até esgotar, e o publisher veria "falhou" muito depois, sem a causa.
  return err instanceof SkillAlreadyExistsError
    || err instanceof NonRetriableOperationError
    || err instanceof VersionRejectedError;
}

/**
 * Run one operation job with the M2 lifecycle: idempotent no-op if already
 * terminal; ACTIVE on success; FAILED (no retry) on a business-rule violation or
 * on the last exhausted attempt; re-throw a transient error so pg-boss retries.
 */
async function runOperationJob(
  deps: WorkerDeps,
  jobName: string,
  /** Inquilino dono do job — vem de `job.data.workspaceId` (M11). */
  workspaceId: string,
  operationId: string,
  skillId: string,
  traceId: string,
  eventType: WebhookEventType,
  retryCount: number,
  action: () => Promise<void>,
): Promise<void> {
  const op = await deps.operationsStoreFor(workspaceId).get(operationId);
  if (op === undefined) {
    return; // operation row gone — nothing to do
  }
  if (op.state === 'ACTIVE' || op.state === 'FAILED') {
    return; // idempotent no-op — already terminal (safe under retry)
  }

  try {
    await action();
    await deps.operationsStoreFor(workspaceId).updateState(operationId, 'ACTIVE');
    deps.logger.info({ operation_id: operationId, skill_id: skillId, trace_id: traceId, state: 'ACTIVE', job: jobName }, `${jobName} done`);
    await deps.onTerminal?.({ operationId, skillId, traceId, eventType, state: 'ACTIVE', workspaceId });
  } catch (err) {
    const lastAttempt = retryCount >= MAX_SKILL_RETRY;
    if (isBusinessRule(err) || lastAttempt) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.operationsStoreFor(workspaceId).updateState(operationId, 'FAILED', message);
      deps.logger.error(
        { operation_id: operationId, skill_id: skillId, trace_id: traceId, state: 'FAILED', error: message, job: jobName },
        `${jobName} failed`,
      );
      await deps.onTerminal?.({ operationId, skillId, traceId, eventType, state: 'FAILED', workspaceId });
      return; // no (further) retry
    }
    throw err; // transient — pg-boss retries with backoff
  }
}

export function createCreateSkillHandler(
  deps: WorkerDeps,
): (data: CreateSkillJobData, retryCount: number) => Promise<void> {
  return (data, retryCount) =>
    runOperationJob(deps, JOB_NAMES.CREATE_SKILL, jobWorkspace(data), data.operation_id, data.skill_id, data.trace_id, 'skill.created', retryCount, async () => {
      await deps.skillsStoreFor(jobWorkspace(data)).createWithRevision({
        skillId: data.skill_id,
        name: data.name,
        description: data.description,
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.execution !== undefined ? { execution: data.execution } : {}),
        ...(data.version !== undefined ? { version: data.version } : {}),
        payload: Buffer.from(data.payload_b64, 'base64'),
        contentHash: data.content_hash,
        frontmatter: data.frontmatter,
        skillMd: data.skill_md,
      });
    });
}

export function createUpdateSkillHandler(
  deps: WorkerDeps,
): (data: UpdateSkillJobData, retryCount: number) => Promise<void> {
  return (data, retryCount) =>
    runOperationJob(deps, JOB_NAMES.UPDATE_SKILL, jobWorkspace(data), data.operation_id, data.skill_id, data.trace_id, 'skill.updated', retryCount, async () => {
      const meta: { name?: string; description?: string } = {};
      if (data.mask.includes('displayName') && data.name !== undefined) {
        meta.name = data.name;
      }
      if (data.mask.includes('description') && data.description !== undefined) {
        meta.description = data.description;
      }
      if (meta.name !== undefined || meta.description !== undefined) {
        await deps.skillsStoreFor(jobWorkspace(data)).updateMetadata(data.skill_id, meta);
      }
      // `skillMd` ao lado de `zippedFilesystem`: a rota já converteu o `SKILL.md` avulso em zip
      // antes de enfileirar, então o job é idêntico — só o NOME do campo na máscara difere.
      // Ignorá-lo aqui faria o PATCH responder 202 e não aplicar nada, que foi o defeito medido:
      // a fronteira aceitava e a revisão não mudava, sem erro em lugar nenhum.
      if (
        (data.mask.includes('zippedFilesystem') || data.mask.includes('skillMd')) &&
        data.payload_b64 !== undefined &&
        data.content_hash !== undefined &&
        data.frontmatter !== undefined
      ) {
        await deps.skillsStoreFor(jobWorkspace(data)).addRevision(data.skill_id, {
          payload: Buffer.from(data.payload_b64, 'base64'),
          contentHash: data.content_hash,
          frontmatter: data.frontmatter,
          skillMd: data.skill_md ?? '',
          // Segundo elo: enfileirar a versão não basta — descartá-la AQUI produzia o mesmo
          // sintoma, com a rota já correta. `versionsOf` só lista revisões com versão, então
          // uma coluna nula faz o canal não ter para onde apontar, sem erro algum.
          ...(data.version !== undefined ? { version: data.version } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.execution !== undefined ? { execution: data.execution } : {}),
        });
      }
    });
}

export function createDeleteSkillHandler(
  deps: WorkerDeps,
): (data: DeleteSkillJobData, retryCount: number) => Promise<void> {
  return (data, retryCount) =>
    runOperationJob(deps, JOB_NAMES.DELETE_SKILL, jobWorkspace(data), data.operation_id, data.skill_id, data.trace_id, 'skill.deleted', retryCount, async () => {
      // Idempotent: softDelete returning false (already deleted) is success.
      await deps.skillsStoreFor(jobWorkspace(data)).softDelete(data.skill_id, new Date(data.reserved_until));
    });
}

export interface RegisterWorkerDeps {
  readonly queue: PgBoss;
  readonly createHandler: (data: CreateSkillJobData, retryCount: number) => Promise<void>;
  readonly updateHandler: (data: UpdateSkillJobData, retryCount: number) => Promise<void>;
  readonly deleteHandler: (data: DeleteSkillJobData, retryCount: number) => Promise<void>;
}

function retryCountOf(job: { retryCount?: number }): number {
  return job.retryCount ?? 0;
}

/** Register the create/update/delete consumers (pg-boss v10 batch arrays). */
export async function registerWorker(deps: RegisterWorkerDeps): Promise<void> {
  await deps.queue.work<CreateSkillJobData>(
    JOB_NAMES.CREATE_SKILL,
    { pollingIntervalSeconds: 1, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        await deps.createHandler(job.data, retryCountOf(job));
      }
    },
  );
  await deps.queue.work<UpdateSkillJobData>(
    JOB_NAMES.UPDATE_SKILL,
    { pollingIntervalSeconds: 1, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        await deps.updateHandler(job.data, retryCountOf(job));
      }
    },
  );
  await deps.queue.work<DeleteSkillJobData>(
    JOB_NAMES.DELETE_SKILL,
    { pollingIntervalSeconds: 1, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        await deps.deleteHandler(job.data, retryCountOf(job));
      }
    },
  );
}
