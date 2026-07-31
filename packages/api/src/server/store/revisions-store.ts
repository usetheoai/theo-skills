import { skillRevisions } from '@usetheo/skills/db';
import { and, desc, eq } from 'drizzle-orm';

import { type Db } from '../db.js';

/** Public revision metadata (the payload is fetched on demand, not listed). */
export interface RevisionView {
  readonly revision_id: string;
  readonly skill_id: string;
  readonly content_hash: string;
  readonly create_time: string;
}

export interface RevisionsStore {
  /** Revisions of a skill, most recent first. */
  listBySkill(skillId: string): Promise<RevisionView[]>;
  /** A single revision by id (metadata). */
  getById(revisionId: string): Promise<RevisionView | undefined>;
  /**
   * Bytes da revisão (M7). Separado de `getById` de propósito: o payload é o corpo
   * executável e pode ter megabytes, e embuti-lo no metadado faria toda listagem e todo
   * `update --diff` carregarem o zip inteiro para exibir uma linha.
   */
  getPayload(revisionId: string): Promise<Buffer | undefined>;
}

function toView(row: {
  revisionId: string;
  skillId: string;
  contentHash: string;
  createTime: Date;
}): RevisionView {
  return {
    revision_id: row.revisionId,
    skill_id: row.skillId,
    content_hash: row.contentHash,
    create_time: row.createTime.toISOString(),
  };
}

export function createRevisionsStore(db: Db, workspaceId: string): RevisionsStore {
  return {
    async listBySkill(skillId) {
      const rows = await db
        .select({
          revisionId: skillRevisions.revisionId,
          skillId: skillRevisions.skillId,
          contentHash: skillRevisions.contentHash,
          createTime: skillRevisions.createTime,
        })
        .from(skillRevisions)
        .where(
          and(
            eq(skillRevisions.workspaceId, workspaceId),
            eq(skillRevisions.skillId, skillId),
          ),
        )
        .orderBy(desc(skillRevisions.createTime), desc(skillRevisions.revisionId));
      return rows.map(toView);
    },

    async getById(revisionId) {
      const rows = await db
        .select({
          revisionId: skillRevisions.revisionId,
          skillId: skillRevisions.skillId,
          contentHash: skillRevisions.contentHash,
          createTime: skillRevisions.createTime,
        })
        .from(skillRevisions)
        // O inquilino entra mesmo com `revisionId` sendo unico: sem ele, quem descobrisse
        // (ou adivinhasse) o id de uma revisao alheia leria o payload de outro cliente.
        .where(
          and(
            eq(skillRevisions.workspaceId, workspaceId),
            eq(skillRevisions.revisionId, revisionId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toView(row);
    },

    async getPayload(revisionId) {
      const rows = await db
        .select({ payload: skillRevisions.payload })
        .from(skillRevisions)
        // MESMO filtro de inquilino do `getById`, e aqui ele pesa mais: o que vaza não é
        // metadado, é o corpo que o agente do outro cliente vai carregar e executar.
        .where(
          and(
            eq(skillRevisions.workspaceId, workspaceId),
            eq(skillRevisions.revisionId, revisionId),
          ),
        )
        .limit(1);
      const row = rows[0];
      // `bytea` já chega como Buffer — o tipo da coluna diz isso e o driver cumpre. Havia
      // aqui um normalize defensivo, e o lint mostrou que a asserção que ele exigia era
      // desnecessária: a guarda não protegia de nada que o tipo permitisse.
      return row?.payload;
    },
  };
}
