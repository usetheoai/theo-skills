import { type Scope } from '@usetheo/skills';
import { apiKeys } from '@usetheo/skills/db';
import { eq } from 'drizzle-orm';

import { type ApiKeyRecord, type ApiKeyStore } from '../auth/api-key-verifier.js';
import { type Db } from '../db.js';

/**
 * Adapter Postgres do {@link ApiKeyStore} (M12).
 *
 * A PEÇA QUE FALTAVA. `ApiKeyStore` existia só como interface, consumida por
 * `createApiKeyVerifier` e exercitada apenas contra um duplo nos testes de contrato — sem
 * implementação real, não havia como construir o verificador contra o banco, e por isso o
 * `authVerifier` nunca pôde ser passado no entrypoint de produção. O auth estava escrito,
 * testado e inalcançável.
 *
 * **Não é escopado por inquilino, e isso é correto.** Todo store deste projeto fixa o tenant
 * na construção justamente para que nenhum caminho consiga omiti-lo — mas aqui a regra se
 * inverte pelo mesmo motivo que no resolvedor de token de distribuição: descobrir o workspace
 * é o RESULTADO de resolver a credencial, não uma entrada dela. Exigir o inquilino antes de
 * autenticar seria pedir a resposta como pergunta.
 *
 * A busca é POR HASH, nunca pelo token cru: o segredo não trafega até o banco e um vazamento
 * da tabela não basta para autenticar.
 */
export function createApiKeysStore(db: Db): ApiKeyStore {
  return {
    async findByHash(tokenHash: string): Promise<ApiKeyRecord | null> {
      const rows = await db
        .select({
          tokenHash: apiKeys.tokenHash,
          workspaceId: apiKeys.workspaceId,
          userId: apiKeys.userId,
          scopes: apiKeys.scopes,
          revokedAt: apiKeys.revokedAt,
          expiresAt: apiKeys.expiresAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.tokenHash, tokenHash))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return null;

      // `scopes` é `jsonb`: o driver devolve o valor decodificado, mas o TIPO é `unknown`.
      // Um array malformado na coluna viraria escopo silenciosamente vazio — que nega acesso
      // a quem tem direito — ou pior, um valor não-array que quebraria o `includes` adiante.
      // Normalizar aqui mantém o erro perto da origem.
      const scopes = Array.isArray(row.scopes) ? (row.scopes as Scope[]) : [];

      return {
        tokenHash: row.tokenHash,
        workspaceId: row.workspaceId,
        userId: row.userId,
        scopes,
        revokedAt: row.revokedAt,
        expiresAt: row.expiresAt,
      };
    },
  };
}
