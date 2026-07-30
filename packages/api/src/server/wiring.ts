import { type Pool } from 'pg';

import { createDb } from './db.js';
import { createJsonLogger, type Logger } from './logger.js';
import {
  type CreateSkillJobData,
  type DeleteSkillJobData,
  type UpdateSkillJobData,
} from './queue/queue.js';
import { createOperationsStore } from './store/operations-store.js';
import { createSkillsStore } from './store/skills-store.js';
import {
  createCreateSkillHandler,
  createDeleteSkillHandler,
  createUpdateSkillHandler,
  type OnOperationTerminal,
} from './worker.js';

export interface WorkerHandlers {
  readonly createHandler: (data: CreateSkillJobData, retryCount: number) => Promise<void>;
  readonly updateHandler: (data: UpdateSkillJobData, retryCount: number) => Promise<void>;
  readonly deleteHandler: (data: DeleteSkillJobData, retryCount: number) => Promise<void>;
}

/**
 * Build the create/update/delete job handlers from a pool. Shared by the server
 * boot and the integration tests so the worker and HTTP routes use the same
 * persistence wiring. `onTerminal` fires the webhook on operation completion.
 */
export function buildWorkerHandlers(
  pool: Pool,
  logger: Logger = createJsonLogger(),
  onTerminal?: OnOperationTerminal,
): WorkerHandlers {
  const db = createDb(pool);
  const deps = {
    // Factories, nao instancias: cada job e processado no inquilino que o criou.
    skillsStoreFor: (ws: string) => createSkillsStore(db, ws),
    operationsStoreFor: (ws: string) => createOperationsStore(db, ws),
    logger,
    ...(onTerminal !== undefined ? { onTerminal } : {}),
  };
  return {
    createHandler: createCreateSkillHandler(deps),
    updateHandler: createUpdateSkillHandler(deps),
    deleteHandler: createDeleteSkillHandler(deps),
  };
}
