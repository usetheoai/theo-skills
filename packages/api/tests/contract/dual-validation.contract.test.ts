import { type Principal } from '@usetheo/skills';
import { describe, expect, it } from 'vitest';

import { createDualValidationVerifier } from '../../src/server/auth/dual-validation.js';
import { API_KEY_PREFIX, createOidcVerifier, type IntrospectFn } from '../../src/server/auth/oidc-verifier.js';

/**
 * M12 DoD #1 — dois adapters coexistindo, e a JANELA DE ROTAÇÃO.
 *
 * O roteamento é por FORMA do token (prefixo), não por tentativa-e-erro: tentar um verifier
 * e cair no outro dobraria a latência de todo request OIDC e, pior, transformaria uma
 * indisponibilidade do backend de chaves numa consulta extra ao provedor externo.
 */

const p = (over: Partial<Principal> = {}): Principal => ({
  workspaceId: 'ws_1',
  userId: 'u_1',
  role: 'member',
  scopes: ['skills:read'],
  ...over,
});

describe('createDualValidationVerifier — roteamento por prefixo', () => {
  const apiKeyV = {
    resolvePrincipal: (t: string) => Promise.resolve(t === `${API_KEY_PREFIX}ok` ? p({ userId: 'via_api_key' }) : null),
  };
  const oidcV = { resolvePrincipal: (t: string) => Promise.resolve(t === 'jwt-ok' ? p({ userId: 'via_oidc' }) : null) };

  it('token com o prefixo da casa vai para o verificador de API key', async () => {
    const v = createDualValidationVerifier({ apiKey: apiKeyV, oidc: oidcV });
    expect((await v.resolvePrincipal(`${API_KEY_PREFIX}ok`))?.userId).toBe('via_api_key');
  });

  it('token sem o prefixo vai para o OIDC', async () => {
    const v = createDualValidationVerifier({ apiKey: apiKeyV, oidc: oidcV });
    expect((await v.resolvePrincipal('jwt-ok'))?.userId).toBe('via_oidc');
  });

  it('NÃO faz fallback entre os dois — uma chave inválida da casa não vira consulta ao OIDC', async () => {
    // Fallback dobraria a latência e transformaria uma chave revogada numa consulta ao
    // provedor externo, que é carga que não pedimos e latência que o cliente paga.
    let oidcChamado = 0;
    const v = createDualValidationVerifier({
      apiKey: apiKeyV,
      oidc: {
        resolvePrincipal: () => {
          oidcChamado += 1;
          return Promise.resolve(p());
        },
      },
    });
    expect(await v.resolvePrincipal(`${API_KEY_PREFIX}revogada`)).toBeNull();
    expect(oidcChamado, 'chave da casa inválida consultou o OIDC').toBe(0);
  });

  it('a falha de um verificador PROPAGA (vira 503), não vira null', async () => {
    const v = createDualValidationVerifier({
      apiKey: { resolvePrincipal: () => Promise.reject(new Error('banco fora')) },
      oidc: oidcV,
    });
    await expect(v.resolvePrincipal(`${API_KEY_PREFIX}x`)).rejects.toThrow('banco fora');
  });
});

describe('createOidcVerifier — RFC 7662 introspection', () => {
  const introspectOf = (res: Record<string, unknown>): IntrospectFn => () => Promise.resolve(res);

  it('token ativo resolve o Principal com workspace e scopes das claims', async () => {
    const v = createOidcVerifier({
      introspect: introspectOf({ active: true, sub: 'u_9', workspace_id: 'ws_9', scope: 'skills:read skills:write' }),
    });
    expect(await v.resolvePrincipal('jwt')).toEqual({
      workspaceId: 'ws_9',
      userId: 'u_9',
      role: 'member',
      scopes: ['skills:read', 'skills:write'],
    });
  });

  it('`active: false` devolve null — é a resposta canônica de token revogado', async () => {
    const v = createOidcVerifier({ introspect: introspectOf({ active: false }) });
    expect(await v.resolvePrincipal('jwt')).toBeNull();
  });

  it('token ativo SEM workspace nas claims devolve null — jamais assume um tenant', async () => {
    // O ponto mais perigoso do OIDC num sistema multi-tenant: um provedor externo pode
    // emitir token válido sem a claim de workspace. Assumir `default` daria a um usuário
    // de fora acesso ao tenant compartilhado. Fail-closed.
    const v = createOidcVerifier({ introspect: introspectOf({ active: true, sub: 'u', scope: 'skills:read' }) });
    expect(await v.resolvePrincipal('jwt')).toBeNull();
  });

  it('token ativo sem scope algum resolve com lista vazia (e o requireScope nega depois)', async () => {
    const v = createOidcVerifier({ introspect: introspectOf({ active: true, sub: 'u', workspace_id: 'ws' }) });
    expect((await v.resolvePrincipal('jwt'))?.scopes).toEqual([]);
  });

  it('falha do provedor PROPAGA — indisponibilidade não é "token inválido"', async () => {
    const v = createOidcVerifier({
      introspect: () => Promise.reject(new Error('timeout no provedor')),
    });
    await expect(v.resolvePrincipal('jwt')).rejects.toThrow('timeout no provedor');
  });
});
