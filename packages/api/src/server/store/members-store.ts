import { type WorkspaceRole } from '@usetheo/skills';
import { workspaceUsers } from '@usetheo/skills/db';
import { and, eq, sql } from 'drizzle-orm';

import { type Db } from '../db.js';

/** Um membro do workspace, com o papel que ele carrega NESTE workspace. */
export interface Member {
  readonly userId: string;
  readonly role: WorkspaceRole;
}

/** Erro tipado do invariante de último dono — o handler o traduz em `409`. */
export class LastOwnerError extends Error {
  constructor(workspaceId: string) {
    super(`workspace ${workspaceId} ficaria sem owner`);
    this.name = 'LastOwnerError';
  }
}

export interface MembersStore {
  list(): Promise<Member[]>;
  /** Papel do usuário, ou `null` quando ele não é membro. */
  roleOf(userId: string): Promise<WorkspaceRole | null>;
  upsert(userId: string, role: WorkspaceRole): Promise<void>;
  /**
   * Troca o papel de um membro, preservando o invariante de último dono.
   *
   * @throws {LastOwnerError} quando a mudança deixaria o workspace sem nenhum `owner`.
   */
  changeRole(userId: string, role: WorkspaceRole): Promise<void>;
  remove(userId: string): Promise<void>;
}

/**
 * Store de membros, escopado por workspace na CONSTRUÇÃO — mesmo desenho dos demais
 * (`createSkillsStore(db, workspaceId)`): o filtro é estrutural, não disciplinar.
 */
export function createMembersStore(db: Db, workspaceId: string): MembersStore {
  return {
    async list(): Promise<Member[]> {
      const rows = await db
        .select()
        .from(workspaceUsers)
        .where(eq(workspaceUsers.workspaceId, workspaceId));
      return rows.map((r) => ({ userId: r.userId, role: r.role as WorkspaceRole }));
    },

    async roleOf(userId: string): Promise<WorkspaceRole | null> {
      const rows = await db
        .select()
        .from(workspaceUsers)
        .where(and(eq(workspaceUsers.workspaceId, workspaceId), eq(workspaceUsers.userId, userId)))
        .limit(1);
      return rows[0] === undefined ? null : (rows[0].role as WorkspaceRole);
    },

    async upsert(userId: string, role: WorkspaceRole): Promise<void> {
      await db
        .insert(workspaceUsers)
        .values({ workspaceId, userId, role })
        .onConflictDoUpdate({
          target: [workspaceUsers.workspaceId, workspaceUsers.userId],
          set: { role, updateTime: new Date() },
        });
    },

    async changeRole(userId: string, role: WorkspaceRole): Promise<void> {
      // TRANSAÇÃO com `FOR UPDATE` (M13 DoD #3).
      //
      // A leitura-antes-da-escrita é o clássico read-modify-write: sem o lock, duas demoções
      // concorrentes leem "há 2 owners", ambas concluem que podem prosseguir, e o workspace
      // termina com ZERO owners — estado do qual ninguém consegue sair, porque promover
      // alguém exige ser owner.
      //
      // O `FOR UPDATE` serializa as duas: a segunda transação bloqueia até a primeira
      // committar, e então relê o estado JÁ atualizado (1 owner) e falha corretamente.
      // Um teste unitário jamais expõe isso — daí o teste de integração com duas transações
      // simultâneas de verdade.
      await db.transaction(async (tx) => {
        const owners = await tx.execute(sql`
          SELECT user_id FROM workspace_users
          WHERE workspace_id = ${workspaceId} AND role = 'owner'
          FOR UPDATE
        `);
        const ownerIds = (owners.rows as { user_id: string }[]).map((r) => r.user_id);
        const isDemotingLastOwner = role !== 'owner' && ownerIds.length === 1 && ownerIds[0] === userId;
        if (isDemotingLastOwner) throw new LastOwnerError(workspaceId);

        await tx
          .update(workspaceUsers)
          .set({ role, updateTime: new Date() })
          .where(and(eq(workspaceUsers.workspaceId, workspaceId), eq(workspaceUsers.userId, userId)));
      });
    },

    async remove(userId: string): Promise<void> {
      // Remover o último owner tem o mesmo efeito de demoti-lo: o workspace fica órfão.
      // Mesmo lock, mesma razão.
      await db.transaction(async (tx) => {
        const owners = await tx.execute(sql`
          SELECT user_id FROM workspace_users
          WHERE workspace_id = ${workspaceId} AND role = 'owner'
          FOR UPDATE
        `);
        const ownerIds = (owners.rows as { user_id: string }[]).map((r) => r.user_id);
        if (ownerIds.length === 1 && ownerIds[0] === userId) throw new LastOwnerError(workspaceId);

        await tx
          .delete(workspaceUsers)
          .where(and(eq(workspaceUsers.workspaceId, workspaceId), eq(workspaceUsers.userId, userId)));
      });
    },
  };
}
