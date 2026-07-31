import { createHash, randomBytes } from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { bundleItems, bundles, distributionTokens } from '@usetheo/skills/db';
import { and, eq } from 'drizzle-orm';

import { type Db } from '../db.js';

export const DISTRIBUTION_TOKEN_PREFIX = 'theoskill_dist_';

export interface Bundle {
  readonly bundleId: string;
  readonly name: string;
  readonly items: readonly { skillId: string; channel: string }[];
}

/** O que uma resolução de token devolve — a identidade do DESTINATÁRIO, não do publisher. */
export interface DistributionGrant {
  readonly tokenId: string;
  readonly workspaceId: string;
  readonly bundleId: string;
  readonly quotaPerWindow: number | null;
}

export interface MintedToken {
  readonly tokenId: string;
  /** Valor cru — devolvido UMA vez, nunca recuperável depois. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface BundlesStore {
  create(name: string): Promise<string>;
  get(bundleId: string): Promise<Bundle | null>;
  list(): Promise<Bundle[]>;
  setItems(bundleId: string, items: readonly { skillId: string; channel: string }[]): Promise<void>;
  mintToken(bundleId: string, opts: { ttlMs: number; label?: string; quotaPerWindow?: number }): Promise<MintedToken>;
  revokeToken(tokenId: string): Promise<boolean>;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function createBundlesStore(db: Db, workspaceId: string): BundlesStore {
  const scope = (bundleId: string) => and(eq(bundles.workspaceId, workspaceId), eq(bundles.bundleId, bundleId));

  return {
    async create(name) {
      const bundleId = `bdl_${createId()}`;
      await db.insert(bundles).values({ workspaceId, bundleId, name });
      return bundleId;
    },

    async get(bundleId) {
      const rows = await db.select().from(bundles).where(scope(bundleId)).limit(1);
      const b = rows[0];
      if (b === undefined) return null;
      const items = await db
        .select()
        .from(bundleItems)
        .where(and(eq(bundleItems.workspaceId, workspaceId), eq(bundleItems.bundleId, bundleId)));
      return {
        bundleId: b.bundleId,
        name: b.name,
        items: items.map((i) => ({ skillId: i.skillId, channel: i.channel })),
      };
    },

    async list() {
      const rows = await db.select().from(bundles).where(eq(bundles.workspaceId, workspaceId));
      const out: Bundle[] = [];
      for (const b of rows) {
        const bundle = await this.get(b.bundleId);
        if (bundle !== null) out.push(bundle);
      }
      return out;
    },

    async setItems(bundleId, items) {
      await db
        .delete(bundleItems)
        .where(and(eq(bundleItems.workspaceId, workspaceId), eq(bundleItems.bundleId, bundleId)));
      if (items.length === 0) return;
      await db
        .insert(bundleItems)
        .values(items.map((i) => ({ workspaceId, bundleId, skillId: i.skillId, channel: i.channel })));
    },

    async mintToken(bundleId, opts) {
      const token = `${DISTRIBUTION_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
      const tokenId = `dtk_${createId()}`;
      // Expiração OBRIGATÓRIA — ao contrário das chaves internas, onde `expiresAt` é opcional.
      // Uma credencial de terceiro sem prazo é uma que ninguém lembra de revogar, e ela
      // sobrevive à relação comercial que a justificava.
      const expiresAt = new Date(Date.now() + opts.ttlMs);
      await db.insert(distributionTokens).values({
        tokenId,
        workspaceId,
        bundleId,
        tokenHash: sha256(token),
        label: opts.label ?? null,
        quotaPerWindow: opts.quotaPerWindow ?? null,
        revokedAt: null,
        expiresAt,
      });
      return { tokenId, token, expiresAt };
    },

    async revokeToken(tokenId) {
      const res = await db
        .update(distributionTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(distributionTokens.workspaceId, workspaceId), eq(distributionTokens.tokenId, tokenId)))
        .returning({ tokenId: distributionTokens.tokenId });
      return res.length > 0;
    },
  };
}

/**
 * Resolve um token de distribuição para a concessão que ele carrega.
 *
 * NÃO é escopado por workspace na construção — de propósito, e é a única exceção ao padrão:
 * quem apresenta o token é o cliente de um publisher que ainda não sabemos qual é. Descobrir
 * o workspace é o RESULTADO desta função, não uma entrada dela.
 *
 * Devolve `null` para token inválido, revogado ou expirado. O chamador traduz em `404` — não
 * `403`: confirmar que o token existe mas não serve permitiria a um cliente descobrir bundles
 * de outro publisher por tentativa.
 */
export function createDistributionResolver(db: Db, now: () => Date = () => new Date()) {
  return {
    async resolve(token: string): Promise<DistributionGrant | null> {
      if (!token.startsWith(DISTRIBUTION_TOKEN_PREFIX)) return null;
      const rows = await db
        .select()
        .from(distributionTokens)
        .where(eq(distributionTokens.tokenHash, sha256(token)))
        .limit(1);
      const r = rows[0];
      if (r === undefined) return null;
      if (r.revokedAt !== null) return null;
      if (r.expiresAt.getTime() <= now().getTime()) return null;
      return {
        tokenId: r.tokenId,
        workspaceId: r.workspaceId,
        bundleId: r.bundleId,
        quotaPerWindow: r.quotaPerWindow,
      };
    },
  };
}
