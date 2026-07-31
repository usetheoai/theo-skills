import { createId } from '@paralleldrive/cuid2';
import {
  InvalidSkillIdError,
  parseSkillId,
  type PayloadValidator,
  type SecretScanner,
  type ValidatedPayload,
  validateSkillPayload,
} from '@usetheo/skills';
import { type Context, type Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type PgBoss from 'pg-boss';

import { type Logger } from '../logger.js';
import { resolveTraceId } from '../observability/trace-context.js';
import { type AppEnv, workspaceOf } from '../principal-context.js';
import { JOB_NAMES, SKILL_SEND_OPTIONS } from '../queue/queue.js';
import { type OperationsStore } from '../store/operations-store.js';
import { type RevisionsStore } from '../store/revisions-store.js';
import { type SkillsStore } from '../store/skills-store.js';

const UPDATE_MASK_FIELDS = new Set(['displayName', 'description', 'zippedFilesystem']);

export interface SkillsRoutesDeps {
  readonly skillsStoreFor: (workspaceId: string) => SkillsStore;
  readonly revisionsStoreFor: (workspaceId: string) => RevisionsStore;
  readonly operationsStoreFor: (workspaceId: string) => OperationsStore;
  readonly queue: PgBoss;
  readonly payloadValidator: PayloadValidator;
  readonly secretScanner: SecretScanner;
  readonly logger: Logger;
  readonly reservationHours: number;
  /** Max inbound request body size (bytes) for payload-bearing routes (DoS guard). */
  readonly maxBodyBytes: number;
}

interface IngestResult {
  readonly buffer: Buffer;
  readonly validated: ValidatedPayload;
  readonly name: string;
  readonly description: string;
  readonly frontmatter: Record<string, unknown>;
}

/** A typed boundary error → HTTP 400/409. */
class BoundaryError extends Error {
  constructor(
    readonly status: 400 | 409,
    readonly code: string,
  ) {
    super(code);
  }
}

function decodeBase64Zip(b64: unknown): Buffer {
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new BoundaryError(400, 'invalid_zip');
  }
  return Buffer.from(b64, 'base64');
}

/**
 * Validate a zip payload at the boundary — delegates to the SHARED core checker
 * (`validateSkillPayload`) so the server and the dev CLI never diverge (M5 DRY).
 * Maps a rule violation to the same HTTP 400 + code as before.
 */
async function ingestPayload(deps: SkillsRoutesDeps, b64: unknown): Promise<IngestResult> {
  const buffer = decodeBase64Zip(b64);
  const result = await validateSkillPayload(buffer, {
    payloadValidator: deps.payloadValidator,
    secretScanner: deps.secretScanner,
  });
  if (!result.ok) {
    if (result.code === 'secret_detected') {
      deps.logger.error({ secret_findings: result.details }, 'payload rejected: secret detected');
    }
    throw new BoundaryError(400, result.code);
  }
  return {
    buffer,
    validated: result.validated,
    name: result.name,
    description: result.description,
    frontmatter: result.frontmatter,
  };
}

function fail(c: Context<AppEnv>, err: unknown): Response {
  if (err instanceof BoundaryError) {
    return c.json({ error: err.code }, err.status);
  }
  if (err instanceof InvalidSkillIdError) {
    return c.json({ error: 'invalid_skill_id', message: err.message }, 400);
  }
  throw err;
}

/**
 * Create the operation row, enqueue the job, and emit the runtime metric — the
 * single mutating-LRO seam (DRY). If enqueue fails, the operation is marked
 * `failed` immediately so it is never left stuck (no dangling CREATING).
 */
async function enqueueOperation(
  deps: SkillsRoutesDeps,
  c: Context<AppEnv>,
  args: {
    skillId: string;
    jobName: string;
    initialState: 'CREATING' | 'UPDATING' | 'DELETING';
    idempotencyKey: string | undefined;
    jobData: Record<string, unknown>;
    metric: Readonly<Record<string, unknown>>;
  },
): Promise<Response> {
  const traceId = resolveTraceId(c.req.header('traceparent'));
  const newId = `op_${createId()}`;
  const { operationId, created } = await deps.operationsStoreFor(workspaceOf(c)).create({
    operationId: newId,
    skillId: args.skillId,
    type: args.jobName,
    initialState: args.initialState,
    ...(args.idempotencyKey !== undefined ? { idempotencyKey: args.idempotencyKey } : {}),
  });
  if (!created) {
    // Idempotent replay — return the existing operation without re-enqueuing.
    return c.json({ operation_id: operationId, skill_id: args.skillId }, 202);
  }
  try {
    await deps.queue.send(
      args.jobName,
      {
        operation_id: operationId,
        skill_id: args.skillId,
        trace_id: traceId,
        // O INQUILINO ATRAVESSA A FILA. Sem este campo o worker caía em
        // `data.workspaceId ?? DEFAULT_WORKSPACE_ID` e gravava TODA skill em `default`: o
        // autor publicava, recebia 202, e não a encontrava depois — o `GET` dele filtra pelo
        // próprio workspace.
        //
        // Todo o isolamento provado até aqui era do plano de LEITURA; o de ESCRITA é
        // assíncrono e não propagava nada. Passou despercebido porque os testes de isolamento
        // semeiam por SQL cru, já com o `workspace_id` certo — provam que a leitura respeita
        // o escopo, sobre linhas que nunca passaram pelo caminho de escrita.
        workspaceId: workspaceOf(c),
        ...args.jobData,
      },
      SKILL_SEND_OPTIONS,
    );
  } catch (err) {
    await deps.operationsStoreFor(workspaceOf(c)).updateState(operationId, 'FAILED', `failed to enqueue ${args.jobName}`);
    throw err;
  }
  deps.logger.info(
    { operation_id: operationId, skill_id: args.skillId, trace_id: traceId, job: args.jobName, ...args.metric },
    `${args.jobName} enqueued`,
  );
  return c.json({ operation_id: operationId, skill_id: args.skillId }, 202);
}

function idempotencyKeyOf(c: Context<AppEnv>): string | undefined {
  const key = c.req.header('Idempotency-Key');
  return key !== undefined && key.length > 0 ? key : undefined;
}

export function registerSkillsRoutes(app: Hono<AppEnv>, deps: SkillsRoutesDeps): void {
  const limit = bodyLimit({
    maxSize: deps.maxBodyBytes,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  });

  // POST /v1/skills — validate payload at the boundary, enqueue, 202.
  app.post('/v1/skills', limit, async (c) => {
    let skillId: string;
    let ingest: IngestResult;
    try {
      const body = (await c.req.json().catch(() => null)) as { skill_id?: unknown; zippedFilesystem?: unknown } | null;
      if (body === null) {
        return c.json({ error: 'invalid_input' }, 400);
      }
      skillId = parseSkillId(typeof body.skill_id === 'string' ? body.skill_id : '');
      if (await deps.skillsStoreFor(workspaceOf(c)).isReserved(skillId)) {
        return c.json({ error: 'reserved' }, 409);
      }
      if ((await deps.skillsStoreFor(workspaceOf(c)).getView(skillId)) !== undefined) {
        return c.json({ error: 'already_exists' }, 409);
      }
      ingest = await ingestPayload(deps, body.zippedFilesystem);
    } catch (err) {
      return fail(c, err);
    }

    return enqueueOperation(deps, c, {
      skillId,
      jobName: JOB_NAMES.CREATE_SKILL,
      initialState: 'CREATING',
      idempotencyKey: idempotencyKeyOf(c),
      jobData: {
        name: ingest.name,
        description: ingest.description,
        content_hash: ingest.validated.contentHash,
        payload_b64: ingest.buffer.toString('base64'),
        frontmatter: ingest.frontmatter,
        skill_md: ingest.validated.skillMd,
      },
      metric: { entry_count: ingest.validated.entryCount },
    });
  });

  // GET /v1/skills — keyset-paginated list of live skills.
  app.get('/v1/skills', async (c) => {
    const rawSize = Number(c.req.query('page_size') ?? '50');
    const pageSize = Number.isFinite(rawSize) ? Math.min(Math.max(Math.trunc(rawSize), 1), 200) : 50;
    const pageToken = c.req.query('page_token') ?? null;
    const page = await deps.skillsStoreFor(workspaceOf(c)).listPaginated(pageSize, pageToken);
    return c.json({ skills: page.skills, next_page_token: page.nextPageToken }, 200);
  });

  // GET /v1/skills/:id
  app.get('/v1/skills/:id', async (c) => {
    const skill = await deps.skillsStoreFor(workspaceOf(c)).getView(c.req.param('id'));
    if (skill === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(skill, 200);
  });

  // PATCH /v1/skills/:id — updateMask-driven; LRO when a payload is present.
  app.patch('/v1/skills/:id', limit, async (c) => {
    const skillId = c.req.param('id');
    if ((await deps.skillsStoreFor(workspaceOf(c)).getView(skillId)) === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const mask = (c.req.query('updateMask') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (mask.length === 0 || mask.some((f) => !UPDATE_MASK_FIELDS.has(f))) {
      return c.json({ error: 'invalid_update_mask' }, 400);
    }

    const body = (await c.req.json().catch(() => null)) as
      | { displayName?: unknown; description?: unknown; zippedFilesystem?: unknown }
      | null;
    if (body === null) {
      return c.json({ error: 'invalid_input' }, 400);
    }

    let ingest: IngestResult | undefined;
    if (mask.includes('zippedFilesystem')) {
      try {
        ingest = await ingestPayload(deps, body.zippedFilesystem);
      } catch (err) {
        return fail(c, err);
      }
    }

    const jobData: Record<string, unknown> = { mask };
    if (mask.includes('displayName') && typeof body.displayName === 'string') {
      jobData['name'] = body.displayName;
    }
    if (mask.includes('description') && typeof body.description === 'string') {
      jobData['description'] = body.description;
    }
    if (ingest !== undefined) {
      jobData['content_hash'] = ingest.validated.contentHash;
      jobData['payload_b64'] = ingest.buffer.toString('base64');
      jobData['frontmatter'] = ingest.frontmatter;
      jobData['skill_md'] = ingest.validated.skillMd;
    }
    return enqueueOperation(deps, c, {
      skillId,
      jobName: JOB_NAMES.UPDATE_SKILL,
      initialState: 'UPDATING',
      idempotencyKey: idempotencyKeyOf(c),
      jobData,
      metric: { mask },
    });
  });

  // DELETE /v1/skills/:id — LRO (DELETING). Soft-delete + id reservation in the worker.
  app.delete('/v1/skills/:id', async (c) => {
    const skillId = c.req.param('id');
    if ((await deps.skillsStoreFor(workspaceOf(c)).getView(skillId)) === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const reservedUntil = new Date(Date.now() + deps.reservationHours * 3600_000).toISOString();
    return enqueueOperation(deps, c, {
      skillId,
      jobName: JOB_NAMES.DELETE_SKILL,
      initialState: 'DELETING',
      idempotencyKey: idempotencyKeyOf(c),
      jobData: { reserved_until: reservedUntil },
      metric: { reserved_until: reservedUntil },
    });
  });

  // GET /v1/skills/:id/revisions
  app.get('/v1/skills/:id/revisions', async (c) => {
    const skillId = c.req.param('id');
    if ((await deps.skillsStoreFor(workspaceOf(c)).getView(skillId)) === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const revisions = await deps.revisionsStoreFor(workspaceOf(c)).listBySkill(skillId);
    return c.json({ revisions }, 200);
  });

  // GET /v1/skills/:id/revisions/:revisionId
  app.get('/v1/skills/:id/revisions/:revisionId', async (c) => {
    const revision = await deps.revisionsStoreFor(workspaceOf(c)).getById(c.req.param('revisionId'));
    if (revision === undefined || revision.skill_id !== c.req.param('id')) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(revision, 200);
  });

  // GET /v1/skills/:id/revisions/:revisionId/payload — M7.
  //
  // A ROTA QUE FALTAVA. O `theoskill install` esperava um campo `payload_base64` no metadado
  // acima; a API nunca o devolveu, e a CLI quebrava com `Buffer.from(undefined)` contra o
  // registry real. Os bytes sempre estiveram no banco — não havia por onde lê-los.
  //
  // Binário, e não base64 dentro do JSON: base64 infla 33% e obrigaria toda listagem de
  // revisões a carregar o zip inteiro. O consumidor confere o `content_hash` do metadado
  // ANTES de escrever no disco — é o que torna a separação segura em vez de só econômica.
  app.get('/v1/skills/:id/revisions/:revisionId/payload', async (c) => {
    const store = deps.revisionsStoreFor(workspaceOf(c));
    const revisionId = c.req.param('revisionId');

    // O metadado primeiro, para amarrar a revisão ao skill da URL. Sem esta checagem,
    // `/v1/skills/QUALQUER/revisions/rev_X/payload` serviria os bytes de `rev_X` — o id da
    // revisão viraria a única credencial necessária.
    const revision = await store.getById(revisionId);
    if (revision === undefined || revision.skill_id !== c.req.param('id')) {
      return c.json({ error: 'not_found' }, 404);
    }

    const payload = await store.getPayload(revisionId);
    if (payload === undefined) return c.json({ error: 'not_found' }, 404);

    c.header('content-type', 'application/zip');
    // O hash viaja no cabeçalho para que quem baixa possa conferir sem uma segunda chamada.
    c.header('x-content-hash', revision.content_hash);
    return c.body(new Uint8Array(payload), 200);
  });
}
