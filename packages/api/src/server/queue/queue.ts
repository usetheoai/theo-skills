import PgBoss from 'pg-boss';

import { toPgBossRetry, WEBHOOK_DELIVERY_BACKOFF } from '../resilience/backoff.js';

export const JOB_NAMES = Object.freeze({
  CREATE_SKILL: 'create_skill',
  UPDATE_SKILL: 'update_skill',
  DELETE_SKILL: 'delete_skill',
  WEBHOOK_DELIVERY: 'webhook_delivery',
  EMBED_SKILL: 'embed_skill',
});

export const WEBHOOK_DELIVERY_DLQ_QUEUE_NAME = 'webhook_delivery_dlq';

/** Max retries for a skill job — transient failures retry with backoff (M2). */
export const MAX_SKILL_RETRY = 3;

/** Skill jobs: retry transient failures with exponential backoff (2,4,8s). */
export const SKILL_SEND_OPTIONS: Readonly<
  Pick<PgBoss.SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff'>
> = Object.freeze({ retryLimit: MAX_SKILL_RETRY, retryDelay: 2, retryBackoff: true });

/** Webhook delivery retry: derived from the explicit WEBHOOK_DELIVERY_BACKOFF policy
 * (ADR-2) instead of inline magic numbers, then dead-letter. */
export const WEBHOOK_DELIVERY_SEND_OPTIONS: Readonly<
  Pick<PgBoss.SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'expireInSeconds' | 'deadLetter'>
> = Object.freeze({
  ...toPgBossRetry(WEBHOOK_DELIVERY_BACKOFF),
  expireInSeconds: 60,
  deadLetter: WEBHOOK_DELIVERY_DLQ_QUEUE_NAME,
});

/** Dedup window for a reconciler re-enqueue racing the original send. */
export const WEBHOOK_DELIVERY_SINGLETON_SECONDS = 120;

/** Build a pg-boss instance bound to the Postgres connection URI. */
export function createQueue(uri: string): PgBoss {
  return new PgBoss({ connectionString: uri, application_name: '@usetheo/skills-api' });
}

export interface CreateSkillJobData {
  /**
   * Inquilino dono do trabalho (M11).
   *
   * O worker roda FORA de uma requisicao — nao ha Principal no contexto. Sem carregar o
   * inquilino no proprio job, o worker teria de adivinhar em qual workspace escrever, e
   * qualquer palpite e um vazamento entre clientes.
   *
   * Opcional para os jobs JA enfileirados quando esta versao subir: eles pertencem ao
   * workspace da ponte legada.
   */
  readonly workspaceId?: string;
  readonly operation_id: string;
  readonly skill_id: string;
  /** M9: correlation id propagated HTTP→operation→job→webhook. */
  readonly trace_id: string;
  readonly name: string;
  readonly description: string;
  readonly content_hash: string;
  readonly payload_b64: string;
  readonly frontmatter: Record<string, unknown>;
  /** M3: SKILL.md text — embedding source persisted on the revision. */
  readonly skill_md: string;
}

export interface UpdateSkillJobData {
  /**
   * Inquilino dono do trabalho (M11).
   *
   * O worker roda FORA de uma requisicao — nao ha Principal no contexto. Sem carregar o
   * inquilino no proprio job, o worker teria de adivinhar em qual workspace escrever, e
   * qualquer palpite e um vazamento entre clientes.
   *
   * Opcional para os jobs JA enfileirados quando esta versao subir: eles pertencem ao
   * workspace da ponte legada.
   */
  readonly workspaceId?: string;
  readonly operation_id: string;
  readonly skill_id: string;
  /** M9: correlation id propagated HTTP→operation→job→webhook. */
  readonly trace_id: string;
  readonly mask: readonly string[];
  readonly name?: string;
  readonly description?: string;
  readonly content_hash?: string;
  readonly payload_b64?: string;
  readonly frontmatter?: Record<string, unknown>;
  /** M3: SKILL.md text — present when the payload (zippedFilesystem) changed. */
  readonly skill_md?: string;
}

export interface DeleteSkillJobData {
  /**
   * Inquilino dono do trabalho (M11).
   *
   * O worker roda FORA de uma requisicao — nao ha Principal no contexto. Sem carregar o
   * inquilino no proprio job, o worker teria de adivinhar em qual workspace escrever, e
   * qualquer palpite e um vazamento entre clientes.
   *
   * Opcional para os jobs JA enfileirados quando esta versao subir: eles pertencem ao
   * workspace da ponte legada.
   */
  readonly workspaceId?: string;
  readonly operation_id: string;
  readonly skill_id: string;
  /** M9: correlation id propagated HTTP→operation→job→webhook. */
  readonly trace_id: string;
  readonly reserved_until: string;
}

export interface WebhookDeliveryJobData {
  /**
   * Inquilino dono do trabalho (M11).
   *
   * O worker roda FORA de uma requisicao — nao ha Principal no contexto. Sem carregar o
   * inquilino no proprio job, o worker teria de adivinhar em qual workspace escrever, e
   * qualquer palpite e um vazamento entre clientes.
   *
   * Opcional para os jobs JA enfileirados quando esta versao subir: eles pertencem ao
   * workspace da ponte legada.
   */
  readonly workspaceId?: string;
  readonly delivery_id: string;
  readonly endpoint_id: string;
  /** M9: correlation id carried from the operation that triggered the delivery. */
  readonly trace_id: string;
  readonly payload: Record<string, unknown>;
}

/** M3: embed a SPECIFIC revision (resolved at enqueue time, singleton-keyed by it
 * so each revision is embedded exactly once and an update never dedups the new
 * revision against the previous one). */
export interface EmbedSkillJobData {
  /**
   * Inquilino dono do trabalho (M11).
   *
   * O worker roda FORA de uma requisicao — nao ha Principal no contexto. Sem carregar o
   * inquilino no proprio job, o worker teria de adivinhar em qual workspace escrever, e
   * qualquer palpite e um vazamento entre clientes.
   *
   * Opcional para os jobs JA enfileirados quando esta versao subir: eles pertencem ao
   * workspace da ponte legada.
   */
  readonly workspaceId?: string;
  readonly skill_id: string;
  readonly revision_id: string;
}

export const EMBED_SKILL_DLQ_QUEUE_NAME = 'embed_skill_dlq';

/** Embed jobs: retry transient embedder/DB failures with backoff, then dead-letter. */
export const EMBED_SKILL_SEND_OPTIONS: Readonly<
  Pick<PgBoss.SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'>
> = Object.freeze({
  retryLimit: 4,
  retryDelay: 2,
  retryBackoff: true,
  deadLetter: EMBED_SKILL_DLQ_QUEUE_NAME,
});

/** Dedup window so two terminal events for the same skill collapse to one embed. */
export const EMBED_SKILL_SINGLETON_SECONDS = 30;
