import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { EMBEDDING_DIM } from '../../domain/embedders/types.js';
import { DEFAULT_WORKSPACE_ID } from '../../domain/principal.js';
import { SKILL_LIFECYCLES } from '../../domain/skill-lifecycle.js';

// Single source of truth for the embedding dimension lives in the domain port;
// infra MAY depend on domain (allowed direction). Avoids drift (DRY).

/** Postgres `bytea` column type (Drizzle has no native helper). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Embedding column dimension — derived from the domain contract (no drift). */
export const EMBEDDING_COLUMN_DIM = EMBEDDING_DIM;

/**
 * Postgres `vector(1536)` column type (pgvector). Encodes `number[]` to the
 * `[a,b,c]` literal on the way in and parses it back on the way out. Dimension
 * is pinned (M3 ADR D2) — changing it requires a migration + ADR.
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_COLUMN_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(raw: string): number[] {
    return JSON.parse(raw) as number[];
  },
});

/** Postgres `tsvector` column type for full-text search (M4). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * Skills — the registered capability. M1 adds the pointer to the current
 * revision and the soft-delete + id-reservation columns (ADR-3/ADR-5).
 */
export const skills = pgTable(
  'skills',
  {
    // M11 — âncora do inquilino. Primeira coluna de toda consulta e de todo índice.
    //
    // O `skill_id` DEIXOU de ser PK global: como PK única, o primeiro inquilino a registrar
    // `deploy-helper` bloquearia o nome para todos os outros para sempre — agravado pela
    // regra de reserva pós-delete. A identidade agora é o PAR (workspace, skill).
    workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
    skillId: text('skill_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    state: text('state').notNull().default('ACTIVE'),
    latestRevisionId: text('latest_revision_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    reservedUntil: timestamp('reserved_until', { withTimezone: true }),
    // M4: denormalized lexical text (name + description + current SKILL.md body),
    // maintained synchronously by skills-store on every write path.
    searchText: text('search_text').notNull().default(''),
    /**
     * Visibilidade (M14): `private` (só o workspace) · `shared` (organização) · `public`
     * (catálogo curado). Default `private` — a visibilidade só aumenta por ação explícita,
     * nunca por omissão de configuração.
     */
    visibility: text('visibility').notNull().default('private'),
    /**
     * Eixo de descoberta (M23), TEXTO LIVRE — `Sales`, `Shop`, … Nulo = sem categoria.
     *
     * Livre de propósito: uma lista fechada travaria quem publica numa taxonomia que nós
     * escolhemos hoje. É filtro AUXILIAR da busca semântica, não substituto dela.
     */
    category: text('category'),
    /**
     * Onde a skill EXECUTA (M23): `remote` (instrução — o agente carrega o corpo do
     * servidor, nada em disco) ou `local` (traz script — instala via npx e roda na máquina
     * do cliente, porque código precisa do sistema de arquivos e dos segredos de lá).
     *
     * Default `remote`: é o caso comum, e a fronteira de publicação recusa um payload com
     * script que se declare remoto — então o default não pode mentir.
     */
    execution: text('execution').notNull().default('remote'),
    /**
     * Ciclo de vida EDITORIAL (M32): `active` · `draft` · `deprecated`.
     *
     * Eixo distinto de `state` (exclusão, que RESERVA o id) e de `enabled` (liga/desliga
     * operacional). As três respondem perguntas diferentes — ver `domain/skill-lifecycle.ts`.
     *
     * Default `active`, não `draft`: a linha que já existe estava em produção, e marcá-la
     * rascunho a esconderia da busca no instante da migração — quebra silenciosa justamente
     * na entrega que promete não quebrar. O `draft` como default de REGISTRO NOVO é regra da
     * API, não do banco.
     *
     * O vocabulário vem do domínio (`SKILL_LIFECYCLES`), nunca de uma segunda lista de
     * strings — foi a duplicação que deixou `state` virar `text` sem restrição alguma. A
     * CHECK constraint que trava os valores é aplicada na migração (ADR D5).
     */
    lifecycle: text('lifecycle', { enum: SKILL_LIFECYCLES }).notNull().default('active'),
    /**
     * Habilitação operacional (M32). Reversível e sem juízo editorial: desligar não é
     * descontinuar. Compõe com `lifecycle` em vez de anulá-lo — pedir os desabilitados na
     * busca não passa a devolver rascunhos junto.
     */
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Por que foi descontinuada, e o que usar no lugar (M32). Obrigatório na fronteira quando
     * o destino é `deprecated`; a coluna é nula porque skills não-deprecadas não têm motivo.
     *
     * Sem estes dois, um agente que recebe "deprecada" tem a mesma informação de um 404: sabe
     * que parou, não sabe o que fazer. O registry investigado não tem nenhum dos dois.
     */
    deprecationReason: text('deprecation_reason'),
    supersededBy: text('superseded_by'),
    /** Quem promoveu a `public`, e quando — proveniência exigida pelo DoD. */
    publishedBy: text('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // M4: generated FTS vector over search_text; GIN-indexed for hybrid retrieve.
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(sql`to_tsvector('english', search_text)`),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp('update_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Identidade composta: o MESMO skillId coexiste em workspaces diferentes.
    primaryKey({ columns: [t.workspaceId, t.skillId], name: 'skills_pkey' }),
    index('skills_search_tsv_gin').using('gin', t.searchTsv),
    // O planner precisa de um caminho barato para o recorte do inquilino ANTES de tocar
    // GIN/HNSW — sem ele, a busca varre o catálogo inteiro e filtra depois.
    index('skills_workspace_idx').on(t.workspaceId),
    // O filtro por categoria roda ANTES da busca semântica e sempre sob o inquilino —
    // um índice só em `category` seria varrido para todo tenant.
    index('skills_workspace_category_idx').on(t.workspaceId, t.category),
  ],
);

/**
 * Skill revisions — immutable snapshots (ADR-3). Never UPDATEd. The zip payload
 * is stored as bytea; `content_hash` is the sha256 of the zip (integrity + dedup);
 * `frontmatter` is the parsed SKILL.md frontmatter (jsonb, unknown fields kept).
 */
export const skillRevisions = pgTable(
  'skill_revisions',
  {
    revisionId: text('revision_id').primaryKey(),
    // M11 — o inquilino dono da revisão. A revisão pertence à skill, e a skill ao workspace.
    workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
    skillId: text('skill_id').notNull(),
    payload: bytea('payload').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Versão semântica declarada no SKILL.md (M19). Nula nas revisões anteriores ao M19. */
    version: text('version'),
    frontmatter: jsonb('frontmatter').notNull(),
    // M3: the SKILL.md markdown text captured at ingest — the embed worker reads
    // it (with name + description) as the embedding source, avoiding a re-unzip.
    skillMd: text('skill_md').notNull().default(''),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Índice LIDERADO pelo inquilino: listar revisões é sempre "as revisões desta skill
    // DESTE workspace".
    index('skill_revisions_ws_skill_create_idx').on(t.workspaceId, t.skillId, desc(t.createTime)),
  ],
);

/**
 * Embeddings — one dense vector per (revision, provider, model). M3. Generated
 * asynchronously by the `embed_skill` worker; idempotent via the unique index +
 * `ON CONFLICT DO NOTHING`. HNSW cosine index powers intent search (M4).
 */
export const embeddings = pgTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    // M11 — o filtro do inquilino na busca vetorial.
    workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
    revisionId: text('revision_id')
      .notNull()
      .references(() => skillRevisions.revisionId, { onDelete: 'cascade' }),
    skillId: text('skill_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    vector: vector('vector').notNull(),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('embeddings_revision_provider_model_uq').on(t.revisionId, t.provider, t.model),
    // O HNSW indexa APENAS o vetor — pgvector não aceita coluna de filtro liderando um
    // índice ANN. O recorte do inquilino depende deste B-tree, que o planner combina com a
    // busca vetorial. É exatamente aqui que mora o risco de recall medido em T5.1:
    // pre-filter preserva recall mas pode abandonar o HNSW; post-filter usa o índice e
    // derruba o recall.
    index('embeddings_workspace_idx').on(t.workspaceId),
    index('embeddings_vector_hnsw').using('hnsw', t.vector.op('vector_cosine_ops')),
  ],
);

/**
 * Operations — first-class long-running operation (ADR-1). pg-boss carries the
 * job; the authoritative operation state lives here.
 */
export const operations = pgTable(
  'operations',
  {
    operationId: text('operation_id').primaryKey(),
    // M11 — o inquilino que pediu a operação.
    workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
    // NO foreign key to skills.skill_id BY DESIGN: the operation row is created
    // (CREATING) before the skill exists — the worker inserts the skill only on
    // success. An FK here would make the operation insert fail. Do not "fix" this.
    skillId: text('skill_id').notNull(),
    type: text('type').notNull(),
    state: text('state').notNull(),
    error: text('error'),
    // M2: optional client idempotency key — a resend with the same key returns
    // the same operation (partial-unique: many NULLs allowed).
    idempotencyKey: text('idempotency_key'),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp('update_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotência é POR INQUILINO: dois workspaces podem usar a mesma chave sem colidir.
    // Fosse global, um inquilino conseguiria adivinhar a chave de outro e receber a operação
    // alheia — vazamento por canal lateral.
    uniqueIndex('operations_ws_idempotency_key_uq')
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('operations_workspace_idx').on(t.workspaceId),
  ],
);

/** Webhook endpoints — subscriptions that receive skill events (M2). */
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  // M11 — endpoints são por inquilino: ninguém assina eventos do catálogo alheio.
  workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
  url: text('url').notNull(),
  // Server-generated HMAC secret, returned once on create.
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  // Optional event-type filter (jsonb array); null/empty = all events.
  eventTypes: jsonb('event_types'),
  createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp('update_time', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Webhook deliveries — the durable outbox row (M2, ADR-3). The reconciler
 * recovers rows whose original enqueue never landed (orphan = all of
 * delivered_at/failed_at/enqueued_at NULL).
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    // M11 — desnormalizado a partir do endpoint para o reconciliador varrer por inquilino
    // sem join.
    workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    // M9: correlation id propagated end-to-end (HTTP→operation→job→webhook). Persisted
    // so the orphan-reconciler re-enqueue preserves it (EC-1).
    traceId: text('trace_id').notNull().default(''),
    attemptCount: integer('attempt_count').notNull().default(0),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_deliveries_orphan_scan')
      .on(t.createTime)
      .where(sql`${t.deliveredAt} IS NULL AND ${t.failedAt} IS NULL AND ${t.enqueuedAt} IS NULL`),
  ],
);

export type SkillRow = typeof skills.$inferSelect;
export type SkillRevisionRow = typeof skillRevisions.$inferSelect;
export type OperationRow = typeof operations.$inferSelect;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type EmbeddingRow = typeof embeddings.$inferSelect;

/**
 * Usuários e membros de workspace (M13).
 *
 * `users` é global; `workspace_users` é a relação M:N que carrega o PAPEL. O papel vive na
 * RELAÇÃO e não no usuário porque a mesma pessoa é `owner` de um workspace e `member` de
 * outro — modelar no usuário forçaria uma linha por combinação e perderia essa distinção.
 */
export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull().unique(),
  createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceUsers = pgTable(
  'workspace_users',
  {
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    /** `owner` ⊇ `admin` ⊇ `member` — a mesma hierarquia de `roleSatisfies`. */
    role: text('role').notNull().default('member'),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp('update_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId], name: 'workspace_users_pkey' }),
    // Índice para a contagem de owners do last-owner invariant: ela roda dentro de uma
    // transação com FOR UPDATE, e um seq scan ali seguraria o lock por mais tempo do que
    // o necessário — exatamente sob a concorrência que o invariante existe para tratar.
    index('workspace_users_role_idx').on(t.workspaceId, t.role),
  ],
);

/**
 * Chaves de API cunhadas por workspace (M12 persistido + M13 anti-escalation).
 *
 * Guarda apenas o HASH: o token cru é mostrado uma vez na cunhagem e nunca mais. Um store
 * que guardasse o valor transformaria um dump de banco em vazamento de todas as credenciais.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    keyId: text('key_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** Dono da chave: define o TETO de privilégio que ela pode carregar (anti-escalation). */
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scopes: jsonb('scopes').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_keys_workspace_idx').on(t.workspaceId)],
);

export type UserRow = typeof users.$inferSelect;
export type WorkspaceUserRow = typeof workspaceUsers.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;

/**
 * Canais mutáveis por skill (M19).
 *
 * Um canal é um PONTEIRO para uma revisão — `stable`, `beta`, ou um nome do publisher. A
 * revisão continua imutável; o que muda é para onde o canal aponta. Essa distinção é o que
 * permite corrigir uma skill sem reemitir nada no lado do consumidor.
 */
export const skillChannels = pgTable(
  'skill_channels',
  {
    workspaceId: text('workspace_id').notNull(),
    skillId: text('skill_id').notNull(),
    /** `stable` · `beta` · nomeado pelo publisher. */
    channel: text('channel').notNull(),
    revisionId: text('revision_id').notNull(),
    /** Para onde o canal apontava antes — torna a promoção REVERSÍVEL sem consultar log. */
    previousRevisionId: text('previous_revision_id'),
    updatedBy: text('updated_by'),
    updateTime: timestamp('update_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.skillId, t.channel], name: 'skill_channels_pkey' })],
);

export type SkillChannelRow = typeof skillChannels.$inferSelect;

/**
 * Bundles — o conjunto curado que um publisher distribui aos CLIENTES DELE (M20).
 *
 * Um bundle referencia skills por CANAL, não por revisão fixa: corrigir uma skill propaga
 * para todos os destinatários sem reemitir um único token. Fixar revisão obrigaria o
 * publisher a reemitir credenciais a cada correção — e ninguém faria isso, então as
 * correções não chegariam.
 */
export const bundles = pgTable(
  'bundles',
  {
    workspaceId: text('workspace_id').notNull(),
    bundleId: text('bundle_id').notNull(),
    name: text('name').notNull(),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.bundleId], name: 'bundles_pkey' })],
);

/** Itens do bundle — cada um aponta para uma skill e o CANAL a seguir. */
export const bundleItems = pgTable(
  'bundle_items',
  {
    workspaceId: text('workspace_id').notNull(),
    bundleId: text('bundle_id').notNull(),
    skillId: text('skill_id').notNull(),
    channel: text('channel').notNull().default('stable'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.bundleId, t.skillId], name: 'bundle_items_pkey' })],
);

/**
 * Tokens de distribuição — emitidos pelo PUBLISHER para os clientes dele.
 *
 * Escopados a UM bundle e com expiração OBRIGATÓRIA (`expiresAt` é notNull, ao contrário das
 * chaves de API internas): uma credencial de terceiro sem prazo é uma que ninguém lembra de
 * revogar. Guarda apenas o hash — o valor sai uma vez, na emissão.
 */
export const distributionTokens = pgTable(
  'distribution_tokens',
  {
    tokenId: text('token_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    bundleId: text('bundle_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label'),
    /** Requisições por janela para este token. `null` = usa o padrão do publisher. */
    quotaPerWindow: integer('quota_per_window'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('distribution_tokens_bundle_idx').on(t.workspaceId, t.bundleId)],
);

export type BundleRow = typeof bundles.$inferSelect;
export type BundleItemRow = typeof bundleItems.$inferSelect;
export type DistributionTokenRow = typeof distributionTokens.$inferSelect;

/**
 * Eventos de instalação (M21) — a telemetria que o publisher pede no primeiro dia.
 *
 * Guarda o token por **id**, NUNCA o valor: um evento com o segredo dentro transformaria a
 * tabela de telemetria numa segunda cópia do cofre de credenciais, e telemetria costuma ter
 * retenção mais longa e acesso mais amplo que credencial.
 */
export const installEvents = pgTable(
  'install_events',
  {
    eventId: text('event_id').primaryKey(),
    /** Publisher dono do bundle — o único que pode ler estes eventos. */
    workspaceId: text('workspace_id').notNull(),
    bundleId: text('bundle_id').notNull(),
    tokenId: text('token_id').notNull(),
    skillId: text('skill_id').notNull(),
    revisionId: text('revision_id').notNull(),
    version: text('version'),
    createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('install_events_bundle_idx').on(t.workspaceId, t.bundleId, t.createTime),
  ],
);

export type InstallEventRow = typeof installEvents.$inferSelect;
