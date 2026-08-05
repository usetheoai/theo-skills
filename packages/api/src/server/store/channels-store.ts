import { skillChannels, skillRevisions } from '@usetheo/skills/db';
import { and, eq, isNotNull } from 'drizzle-orm';

import { type Db } from '../db.js';

export interface Channel {
  readonly channel: string;
  readonly revisionId: string;
  readonly previousRevisionId: string | null;
}

/** Erro tipado: a revisão está fixada por um canal — o handler traduz em `409`. */
export class RevisionPinnedError extends Error {
  constructor(revisionId: string, channels: readonly string[]) {
    super(`revision ${revisionId} is referenced by the channels: ${channels.join(', ')}`);
    this.name = 'RevisionPinnedError';
  }
}

export interface ChannelsStore {
  list(skillId: string): Promise<Channel[]>;
  get(skillId: string, channel: string): Promise<Channel | null>;
  /** Aponta o canal para uma revisão, guardando o alvo anterior (promoção reversível). */
  promote(skillId: string, channel: string, revisionId: string, actor: string | null): Promise<void>;
  /** Volta o canal ao alvo anterior. `false` quando não há para onde voltar. */
  rollback(skillId: string, channel: string): Promise<boolean>;
  /** Versões publicadas da skill, para a resolução de intervalo. */
  versionsOf(skillId: string): Promise<{ version: string; revisionId: string }[]>;
  /** Canais que apontam para a revisão — vazio significa que ela pode ser apagada. */
  channelsPinning(skillId: string, revisionId: string): Promise<string[]>;
}

export function createChannelsStore(db: Db, workspaceId: string): ChannelsStore {
  const scope = (skillId: string) =>
    and(eq(skillChannels.workspaceId, workspaceId), eq(skillChannels.skillId, skillId));

  return {
    async list(skillId) {
      const rows = await db.select().from(skillChannels).where(scope(skillId));
      return rows.map((r) => ({
        channel: r.channel,
        revisionId: r.revisionId,
        previousRevisionId: r.previousRevisionId,
      }));
    },

    async get(skillId, channel) {
      const rows = await db
        .select()
        .from(skillChannels)
        .where(and(scope(skillId), eq(skillChannels.channel, channel)))
        .limit(1);
      const r = rows[0];
      return r === undefined
        ? null
        : { channel: r.channel, revisionId: r.revisionId, previousRevisionId: r.previousRevisionId };
    },

    async promote(skillId, channel, revisionId, actor) {
      // O alvo ANTERIOR é gravado na mesma escrita que o novo. Guardá-lo aqui — em vez de
      // reconstruí-lo de um log — é o que torna a reversão uma operação, e não uma
      // investigação: quem precisa reverter costuma estar no meio de um incidente.
      const atual = await this.get(skillId, channel);
      await db
        .insert(skillChannels)
        .values({
          workspaceId,
          skillId,
          channel,
          revisionId,
          previousRevisionId: atual?.revisionId ?? null,
          updatedBy: actor,
        })
        .onConflictDoUpdate({
          target: [skillChannels.workspaceId, skillChannels.skillId, skillChannels.channel],
          set: {
            revisionId,
            previousRevisionId: atual?.revisionId ?? null,
            updatedBy: actor,
            updateTime: new Date(),
          },
        });
    },

    async rollback(skillId, channel) {
      const atual = await this.get(skillId, channel);
      if (atual?.previousRevisionId == null) return false;
      // A reversão TROCA os dois: quem voltou pode querer avançar de novo. Sem isso, reverter
      // seria uma via de mão única e o operador ficaria preso na versão antiga.
      await db
        .update(skillChannels)
        .set({ revisionId: atual.previousRevisionId, previousRevisionId: atual.revisionId, updateTime: new Date() })
        .where(and(scope(skillId), eq(skillChannels.channel, channel)));
      return true;
    },

    async versionsOf(skillId) {
      const rows = await db
        .select({ version: skillRevisions.version, revisionId: skillRevisions.revisionId })
        .from(skillRevisions)
        .where(
          and(
            eq(skillRevisions.workspaceId, workspaceId),
            eq(skillRevisions.skillId, skillId),
            isNotNull(skillRevisions.version),
          ),
        );
      return rows.map((r) => ({ version: r.version ?? '', revisionId: r.revisionId }));
    },

    async channelsPinning(skillId, revisionId) {
      const rows = await db
        .select()
        .from(skillChannels)
        .where(and(scope(skillId), eq(skillChannels.revisionId, revisionId)));
      return rows.map((r) => r.channel);
    },
  };
}
