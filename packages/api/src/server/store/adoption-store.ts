import { createId } from '@paralleldrive/cuid2';
import { installEvents } from '@usetheo/skills/db';
import { and, eq, gte, sql } from 'drizzle-orm';

import { type Db } from '../db.js';

export interface InstallEvent {
  readonly bundleId: string;
  readonly tokenId: string;
  readonly skillId: string;
  readonly revisionId: string;
  readonly version: string | null;
}

export interface AdoptionRow {
  readonly skillId: string;
  readonly version: string | null;
  readonly installs: number;
}

export interface AdoptionStore {
  record(e: InstallEvent): Promise<void>;
  /** Adoção do bundle numa janela. Só o DONO chega aqui — o store é escopado ao publisher. */
  adoption(bundleId: string, since: Date): Promise<AdoptionRow[]>;
  /** Total de eventos numa janela — base do número que o ADR 0005 pede. */
  countSince(since: Date): Promise<number>;
}

/**
 * Store de adoção, escopado ao PUBLISHER na construção (M21 DoD #2 e #5).
 *
 * O escopo estrutural é o que impede o vazamento entre publishers — inclusive o vazamento
 * **por diferença de contagem agregada**, que um filtro aplicado só na leitura final deixaria
 * passar: bastaria comparar dois totais para inferir a atividade do vizinho.
 */
export function createAdoptionStore(db: Db, workspaceId: string): AdoptionStore {
  return {
    async record(e) {
      // O token entra por ID. Guardar o valor transformaria a telemetria numa segunda cópia
      // do cofre de credenciais — com retenção mais longa e acesso mais amplo.
      await db.insert(installEvents).values({
        eventId: `evt_${createId()}`,
        workspaceId,
        bundleId: e.bundleId,
        tokenId: e.tokenId,
        skillId: e.skillId,
        revisionId: e.revisionId,
        version: e.version,
      });
    },

    async adoption(bundleId, since) {
      const rows = await db
        .select({
          skillId: installEvents.skillId,
          version: installEvents.version,
          installs: sql<string>`count(*)`,
        })
        .from(installEvents)
        .where(
          and(
            eq(installEvents.workspaceId, workspaceId),
            eq(installEvents.bundleId, bundleId),
            gte(installEvents.createTime, since),
          ),
        )
        .groupBy(installEvents.skillId, installEvents.version);
      return rows.map((r) => ({ skillId: r.skillId, version: r.version, installs: Number(r.installs) }));
    },

    async countSince(since) {
      const rows = await db
        .select({ n: sql<string>`count(*)` })
        .from(installEvents)
        .where(and(eq(installEvents.workspaceId, workspaceId), gte(installEvents.createTime, since)));
      return Number(rows[0]?.n ?? 0);
    },
  };
}
