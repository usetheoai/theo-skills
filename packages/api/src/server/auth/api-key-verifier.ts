import { createHash, timingSafeEqual } from 'node:crypto';

import { type AuthVerifier, type Principal, type Scope } from '@usetheo/skills';

/** Uma chave de API persistida. O `tokenHash` é sha256 hex — o token cru nunca é guardado. */
export interface ApiKeyRecord {
  readonly tokenHash: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly scopes: readonly Scope[];
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
}

/**
 * Port de leitura das chaves (DIP) — o verificador não conhece Postgres.
 *
 * A busca é POR HASH, nunca pelo token: um store que recebesse o segredo cru o deixaria
 * no log de query, que é como credencial vaza sem ninguém perceber.
 */
export interface ApiKeyStore {
  findByHash(tokenHash: string): Promise<ApiKeyRecord | null>;
}

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Comparação em tempo constante de duas strings hex (M12 DoD #2).
 *
 * O curto-circuito por comprimento não é otimização: `timingSafeEqual` LANÇA `RangeError`
 * em buffers de tamanhos diferentes, e deixar esse throw escapar transformaria um palpite
 * de tamanho errado num 500 — distinguível de um 401, e portanto exatamente o oráculo que
 * a comparação em tempo constante existe para fechar.
 *
 * Comparar comprimento vaza apenas o TAMANHO do hash, que é fixo e público (64 hex chars
 * para sha256): não há informação a extrair dali.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Adapter de API key do {@link AuthVerifier}.
 *
 * Responde "de quem é esta chave?" devolvendo o {@link Principal} com o `workspaceId` e os
 * `scopes` **da credencial** — a origem única do tenant em toda consulta escopada.
 */
export function createApiKeyVerifier(store: ApiKeyStore, clock: () => Date = () => new Date()): AuthVerifier {
  return {
    async resolvePrincipal(token: string): Promise<Principal | null> {
      // Fail-closed antes do I/O: token vazio nunca vira consulta ao banco.
      if (token === '') return null;

      const hash = sha256Hex(token);
      // Uma falha aqui PROPAGA de propósito — o middleware a traduz em 503. Devolver null
      // confundiria "não sei" com "não é válido", negando acesso a quem tem direito e
      // escondendo a indisponibilidade atrás de um 401 enganoso.
      const record = await store.findByHash(hash);
      if (record === null) return null;

      // Redundante em relação à busca por hash — e mantido de propósito: se um dia o store
      // for trocado por um que faça correspondência aproximada (prefixo, LIKE, cache), esta
      // linha é a que continua exigindo igualdade exata, em tempo constante.
      if (!constantTimeEquals(record.tokenHash, hash)) return null;

      if (record.revokedAt !== null) return null;
      if (record.expiresAt !== null && record.expiresAt.getTime() <= clock().getTime()) return null;

      return {
        workspaceId: record.workspaceId,
        userId: record.userId,
        role: 'member',
        scopes: [...record.scopes],
      };
    },
  };
}
