import { type Operation, type OperationState, OperationStateSchema } from '@usetheo/skills/contract';
import { operations } from '@usetheo/skills/db';
import { and, eq } from 'drizzle-orm';

import { type Db } from '../db.js';
import { isUniqueViolation } from '../persistence/pg-errors.js';

/** In-progress state an operation starts in, chosen by the job type. */
export type InitialOperationState = 'CREATING' | 'UPDATING' | 'DELETING';

export interface NewOperation {
  readonly operationId: string;
  readonly skillId: string;
  readonly type: string;
  readonly initialState: InitialOperationState;
  /** Optional client idempotency key — a resend with the same key is deduped. */
  readonly idempotencyKey?: string;
}

export interface CreatedOperation {
  readonly operationId: string;
  /** false when an existing operation with the same idempotency key was returned. */
  readonly created: boolean;
}

export interface OperationsStore {
  /** Insert an operation (or return the existing one on idempotency-key conflict). */
  create(input: NewOperation): Promise<CreatedOperation>;
  /** Fetch an operation by id, or undefined if absent. */
  get(operationId: string): Promise<Operation | undefined>;
  /** Transition an operation to a new state, optionally with an error. */
  updateState(operationId: string, state: OperationState, error?: string): Promise<void>;
}

function toOperation(row: {
  operationId: string;
  skillId: string;
  type: string;
  state: string;
  error: string | null;
}): Operation {
  return {
    operation_id: row.operationId,
    skill_id: row.skillId,
    type: row.type,
    state: OperationStateSchema.parse(row.state),
    error: row.error,
  };
}

export function createOperationsStore(db: Db, workspaceId: string): OperationsStore {
  async function getByIdempotencyKey(key: string): Promise<Operation | undefined> {
    const rows = await db.select().from(operations).where(and(eq(operations.workspaceId, workspaceId), eq(operations.idempotencyKey, key))).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toOperation(row);
  }

  return {
    async create(input) {
      const values = {
        operationId: input.operationId,
        skillId: input.skillId,
        type: input.type,
        state: input.initialState,
        error: null,
        idempotencyKey: input.idempotencyKey ?? null,
      };
      if (input.idempotencyKey === undefined) {
        await db.insert(operations).values(values);
        return { operationId: input.operationId, created: true };
      }
      try {
        await db.insert(operations).values(values);
        return { operationId: input.operationId, created: true };
      } catch (err) {
        if (isUniqueViolation(err)) {
          const existing = await getByIdempotencyKey(input.idempotencyKey);
          if (existing !== undefined) {
            return { operationId: existing.operation_id, created: false };
          }
        }
        throw err;
      }
    },

    async get(operationId) {
      const rows = await db
        .select()
        .from(operations)
        .where(and(eq(operations.workspaceId, workspaceId), eq(operations.operationId, operationId)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toOperation(row);
    },

    async updateState(operationId, state, error) {
      await db
        .update(operations)
        .set({ state, error: error ?? null, updateTime: new Date() })
        .where(and(eq(operations.workspaceId, workspaceId), eq(operations.operationId, operationId)));
    },
  };
}
