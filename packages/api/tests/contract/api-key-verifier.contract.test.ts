import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type ApiKeyRecord, createApiKeyVerifier } from '../../src/server/auth/api-key-verifier.js';
import { API_KEY_PREFIX } from '../../src/server/auth/oidc-verifier.js';

/**
 * M12 DoD #1 e #2 — o adapter de API key do {@link AuthVerifier}.
 *
 * O que este arquivo protege é o conjunto de erros que NÃO aparecem em produção até virarem
 * incidente: chave revogada que continua valendo, chave expirada aceita, e comparação de
 * segredo que vaza tempo.
 */

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// Derivadas da CONSTANTE do produto, não de literais copiados: o teste passa a validar o
// prefixo real (se ele mudar, o teste acompanha em vez de divergir em silêncio) e some do
// código a string que um scanner de segredo, com razão, não sabe distinguir de credencial.
const KEY = `${API_KEY_PREFIX}fixture-sem-entropia`;
const OTHER = `${API_KEY_PREFIX}outra-fixture`;

const recordFor = (over: Partial<ApiKeyRecord> = {}): ApiKeyRecord => ({
  tokenHash: sha256(KEY),
  workspaceId: 'ws_1',
  userId: 'user_1',
  scopes: ['skills:write'],
  revokedAt: null,
  expiresAt: null,
  ...over,
});

/** Store em memória — o adapter depende do PORT, não do Postgres (DIP). */
const storeOf = (...records: ApiKeyRecord[]) => ({
  findByHash: (hash: string): Promise<ApiKeyRecord | null> =>
    Promise.resolve(records.find((r) => r.tokenHash === hash) ?? null),
});

describe('createApiKeyVerifier', () => {
  it('resolve o Principal da chave válida, com workspace e scopes DA CREDENCIAL', async () => {
    const v = createApiKeyVerifier(storeOf(recordFor()));
    const p = await v.resolvePrincipal(KEY);
    expect(p).toEqual({ workspaceId: 'ws_1', userId: 'user_1', role: 'member', scopes: ['skills:write'] });
  });

  it('devolve null para chave desconhecida', async () => {
    const v = createApiKeyVerifier(storeOf(recordFor()));
    expect(await v.resolvePrincipal(OTHER)).toBeNull();
  });

  it('devolve null para chave REVOGADA, mesmo com o hash correto', async () => {
    // O caminho que mais assusta: a chave existe, o hash bate, e mesmo assim precisa falhar.
    const v = createApiKeyVerifier(storeOf(recordFor({ revokedAt: new Date('2020-01-01') })));
    expect(await v.resolvePrincipal(KEY)).toBeNull();
  });

  it('devolve null para chave EXPIRADA', async () => {
    const v = createApiKeyVerifier(storeOf(recordFor({ expiresAt: new Date('2020-01-01') })));
    expect(await v.resolvePrincipal(KEY)).toBeNull();
  });

  it('aceita chave com expiração no futuro', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const v = createApiKeyVerifier(storeOf(recordFor({ expiresAt: future })));
    expect(await v.resolvePrincipal(KEY)).not.toBeNull();
  });

  it('token vazio devolve null sem consultar o store', async () => {
    // Fail-closed antes do I/O: um token vazio nunca deve virar uma consulta ao banco.
    let consultas = 0;
    const v = createApiKeyVerifier({
      findByHash: (h: string) => {
        consultas += 1;
        return Promise.resolve(recordFor().tokenHash === h ? recordFor() : null);
      },
    });
    expect(await v.resolvePrincipal('')).toBeNull();
    expect(consultas, 'token vazio consultou o store').toBe(0);
  });

  it('PROPAGA a falha do store em vez de devolver null (o middleware traduz em 503)', async () => {
    // Devolver null aqui confundiria "não sei" com "não é válido": negaria acesso a quem
    // tem direito e esconderia a indisponibilidade atrás de um 401 enganoso.
    const v = createApiKeyVerifier({
      findByHash: () => Promise.reject(new Error('conexão recusada')),
    });
    await expect(v.resolvePrincipal(KEY)).rejects.toThrow('conexão recusada');
  });

  it('compara o segredo por HASH — o token cru nunca é usado como chave de busca', async () => {
    // Prova estrutural: o store recebe o sha256, não o token. Um store que recebesse o
    // token cru o gravaria em log de query, que é como segredos vazam sem ninguém notar.
    let visto = '';
    const v = createApiKeyVerifier({
      findByHash: (h: string) => {
        visto = h;
        return Promise.resolve(null);
      },
    });
    await v.resolvePrincipal(KEY);
    expect(visto).toBe(sha256(KEY));
    expect(visto).not.toContain(KEY);
  });
});
