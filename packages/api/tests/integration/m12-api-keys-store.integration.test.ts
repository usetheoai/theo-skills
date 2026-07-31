import { createHash } from 'node:crypto';

import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApiKeyVerifier } from '../../src/server/auth/api-key-verifier.js';
import { createDb } from '../../src/server/db.js';
import { createApiKeysStore } from '../../src/server/store/api-keys-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M12 — o adapter de leitura de chaves que NUNCA existiu.
 *
 * `ApiKeyStore` era só uma interface: `createApiKeyVerifier` a consumia, tinha teste de
 * contrato contra um duplo, e **nenhuma implementação real**. Foi por isso que o auth nunca
 * pôde ser ligado no entrypoint — não havia como construir o verificador contra o banco.
 *
 * A busca é POR HASH e **global** (sem filtro de inquilino), e isso é correto pelo mesmo
 * motivo do resolvedor de token de distribuição: descobrir o workspace é o RESULTADO da
 * resolução da credencial, não uma entrada dela. Filtrar por inquilino aqui exigiria saber o
 * inquilino antes de autenticar — a inversão que torna a autenticação impossível.
 */

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const inserir = async (over: Partial<{ revoked: Date | null; expires: Date | null; scopes: string[] }> = {}) => {
  const token = 'tsk_segredo_do_teste';
  await getPool().query(
    `INSERT INTO api_keys (key_id, workspace_id, user_id, token_hash, scopes, revoked_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      'key_1',
      'ws_dono',
      'u_dono',
      sha256(token),
      JSON.stringify(over.scopes ?? ['skills:read', 'skills:write']),
      over.revoked ?? null,
      over.expires ?? null,
    ],
  );
  return token;
};

describeIntegration('M12 — store de chaves de API', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('resolve o principal a partir do token — workspace, usuário e escopos', async () => {
    const token = await inserir();
    const verifier = createApiKeyVerifier(createApiKeysStore(createDb(getPool())));

    const principal = await verifier.resolvePrincipal(token);
    expect(principal, 'token válido não resolveu').not.toBeNull();
    expect(principal?.workspaceId).toBe('ws_dono');
    expect(principal?.userId).toBe('u_dono');
    expect(principal?.scopes).toContain('skills:write');
  });

  it('token DESCONHECIDO devolve null — e o banco nunca vê o segredo cru', async () => {
    await inserir();
    const verifier = createApiKeyVerifier(createApiKeysStore(createDb(getPool())));
    expect(await verifier.resolvePrincipal('tsk_token_que_nao_existe')).toBeNull();

    // O que está guardado é o hash. Uma consulta pelo valor cru não encontra nada — é o que
    // torna um vazamento do banco insuficiente para autenticar.
    const { rows } = await getPool().query('SELECT token_hash FROM api_keys');
    expect(rows[0]?.['token_hash']).not.toContain('segredo');
  });

  it('chave REVOGADA não autentica', async () => {
    const token = await inserir({ revoked: new Date(Date.now() - 1000) });
    const verifier = createApiKeyVerifier(createApiKeysStore(createDb(getPool())));
    expect(await verifier.resolvePrincipal(token)).toBeNull();
  });

  it('chave EXPIRADA não autentica', async () => {
    const token = await inserir({ expires: new Date(Date.now() - 1000) });
    const verifier = createApiKeyVerifier(createApiKeysStore(createDb(getPool())));
    expect(await verifier.resolvePrincipal(token)).toBeNull();
  });

  it('chave com validade FUTURA autentica', async () => {
    const token = await inserir({ expires: new Date(Date.now() + 3_600_000) });
    const verifier = createApiKeyVerifier(createApiKeysStore(createDb(getPool())));
    expect(await verifier.resolvePrincipal(token)).not.toBeNull();
  });
});
