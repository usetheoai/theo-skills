import { createId } from '@paralleldrive/cuid2';
import { skillRevisions, skills } from '@usetheo/skills/db';
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

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

/**
 * O corpo da skill + o que o consumidor precisa saber ANTES de injetá-lo no prompt (M24).
 *
 * `origin` não é enfeite: uma skill pública é instrução de TERCEIRO que o agente vai seguir.
 * Sem a marca, o consumidor não distingue o que o próprio time publicou do que veio de fora
 * — e essa é justamente a decisão dele.
 */
export interface SkillInstructions {
  readonly skill_id: string;
  readonly instructions: string;
  readonly execution: string;
  readonly origin: 'own' | 'public';
}

export interface NewSkillRevision {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  /** M23 — eixo de descoberta (texto livre). Ausente = sem categoria. */
  readonly category?: string;
  /** M23 — `remote` (instrução, carregada do servidor) ou `local` (script, via npx). */
  readonly execution?: string;
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
  /**
   * Corpo da revisão CORRENTE, para a carga remota (M24).
   *
   * Cobre a união `minhas + públicas` — a mesma cláusula da busca, e nada além dela: uma
   * skill `private` de outro inquilino não satisfaz nenhum dos dois lados. `undefined` para
   * inexistente, apagada e alheia-privada, indistinguíveis de propósito.
   */
  getInstructions(skillId: string): Promise<SkillInstructions | undefined>;
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
function refreshSearchText(
  executor: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  workspaceId: string,
  skillId: string,
): Promise<unknown> {
  return executor.execute(sql`
    UPDATE skills s
    SET search_text = s.name || ' ' || s.description || ' ' || coalesce(r.skill_md, '')
    FROM skill_revisions r
    WHERE r.revision_id = s.latest_revision_id
      AND s.workspace_id = ${workspaceId}
      AND s.skill_id = ${skillId}
  `);
}

/**
 * Cria um store JA ESCOPADO a um workspace.
 *
 * POR QUE A FACTORY RECEBE O INQUILINO, em vez de cada metodo receber um `workspaceId`:
 * sao 17 operacoes so neste store (52 no conjunto). Com o inquilino como parametro de
 * metodo, basta UMA chamada esquecida para vazar o catalogo inteiro de outro cliente — e o
 * compilador nao ajuda, porque o parametro estaria la, so preenchido errado.
 *
 * Escopando na construcao, o filtro deixa de ser disciplina e vira estrutura: nao existe
 * caminho de codigo que alcance o store sem antes ter resolvido de quem e a requisicao.
 * E o mesmo desenho do `memory.withWorkspace('acme')` do theo-memory.
 */
export function createSkillsStore(db: Db, workspaceId: string): SkillsStore {
  /** Todo predicado nasce ancorado no inquilino. */
  const ws = eq(skills.workspaceId, workspaceId);
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
              ws,
              eq(skills.skillId, input.skillId),
              isNotNull(skills.deletedAt),
              lt(skills.reservedUntil, sql`now()`),
            ),
          )
          .returning({ skillId: skills.skillId });
        if (purged.length > 0) {
          await tx
            .delete(skillRevisions)
            .where(
              and(
                eq(skillRevisions.workspaceId, workspaceId),
                eq(skillRevisions.skillId, input.skillId),
              ),
            );
        }
        try {
          await tx.insert(skills).values({
            workspaceId,
            skillId: input.skillId,
            name: input.name,
            description: input.description,
            // Ausente vira NULL, não string vazia: `''` e `NULL` respondem diferente a
            // `WHERE category = $1` e a agregações, e a mistura produz a categoria
            // fantasma que aparece em toda listagem sem ninguém ter criado.
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.execution !== undefined ? { execution: input.execution } : {}),
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
          workspaceId,
          skillId: input.skillId,
          payload: input.payload,
          contentHash: input.contentHash,
          frontmatter: input.frontmatter,
          skillMd: input.skillMd,
        });
        await refreshSearchText(tx, workspaceId, input.skillId);
      });
    },

    async addRevision(skillId, rev) {
      const revisionId = `rev_${createId()}`;
      await db.transaction(async (tx) => {
        await tx.insert(skillRevisions).values({
          revisionId,
          workspaceId,
          skillId,
          payload: rev.payload,
          contentHash: rev.contentHash,
          frontmatter: rev.frontmatter,
          skillMd: rev.skillMd,
        });
        await tx
          .update(skills)
          .set({ latestRevisionId: revisionId, updateTime: new Date() })
          .where(and(ws, eq(skills.skillId, skillId)));
        await refreshSearchText(tx, workspaceId, skillId);
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
        await tx.update(skills).set(patch).where(and(ws, eq(skills.skillId, skillId)));
        await refreshSearchText(tx, workspaceId, skillId);
      });
    },

    async getView(skillId) {
      const rows = await db
        .select(liveColumns)
        .from(skills)
        .where(and(ws, eq(skills.skillId, skillId), isNull(skills.deletedAt)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toView(row);
    },

    async getInstructions(skillId) {
      // UMA consulta: o corpo mora na revisão, o modo de execução e a visibilidade na skill.
      // Duas idas ao banco abririam janela para ler o corpo de uma revisão que a segunda
      // consulta descobriria pertencer a uma skill apagada.
      const rows = await db
        .select({
          skillId: skills.skillId,
          workspaceId: skills.workspaceId,
          execution: skills.execution,
          instructions: skillRevisions.skillMd,
        })
        .from(skills)
        .innerJoin(
          skillRevisions,
          and(
            eq(skillRevisions.workspaceId, skills.workspaceId),
            eq(skillRevisions.revisionId, skills.latestRevisionId),
          ),
        )
        .where(
          and(
            eq(skills.skillId, skillId),
            isNull(skills.deletedAt),
            // Mesma união da busca: as minhas OU as públicas. Uma `private` alheia não
            // satisfaz nenhum lado — e `shared` também não, porque organização ainda não
            // existe no dado.
            or(eq(skills.workspaceId, workspaceId), eq(skills.visibility, 'public')),
          ),
        )
        // A minha tem precedência sobre uma pública homônima: sob a PK composta, o mesmo
        // `skill_id` em dois inquilinos é o caso NORMAL, e sem ordenação a linha devolvida
        // seria arbitrária.
        .orderBy(desc(eq(skills.workspaceId, workspaceId)))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        skill_id: row.skillId,
        instructions: row.instructions,
        execution: row.execution,
        origin: row.workspaceId === workspaceId ? 'own' : 'public',
      };
    },

    async listPaginated(pageSize, pageToken) {
      const where =
        pageToken === null
          ? and(ws, isNull(skills.deletedAt))
          : and(ws, isNull(skills.deletedAt), gt(skills.skillId, pageToken));
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
        .where(and(ws, eq(skills.skillId, skillId), isNull(skills.deletedAt)))
        .returning({ skillId: skills.skillId });
      return result.length > 0;
    },

    async isReserved(skillId) {
      const rows = await db
        .select({ skillId: skills.skillId })
        .from(skills)
        .where(
          and(
            ws,
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
