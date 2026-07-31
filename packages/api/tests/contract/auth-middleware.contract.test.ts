import { DEFAULT_WORKSPACE_ID, type Principal } from '@usetheo/skills';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createAuthMiddleware, requireScope } from '../../src/server/auth/middleware.js';
import { type AppEnv } from '../../src/server/principal-context.js';

/**
 * M12 DoD #3 e #4 — a ordem das respostas é o contrato.
 *
 * `401` antes de `403` não é preferência de estilo: responder `403` a uma credencial
 * INVÁLIDA confirmaria que a rota e o scope existem, dando ao atacante um oráculo para
 * mapear a superfície da API sem ter credencial alguma. E `503` nunca pode virar acesso:
 * quando o backend de auth cai, "não sei quem é" precisa negar, não liberar.
 */

const principalOf = (over: Partial<Principal> = {}): Principal => ({
  workspaceId: 'ws_1',
  userId: 'u_1',
  role: 'member',
  scopes: ['skills:write'],
  ...over,
});

/** App mínimo: o middleware, uma rota livre e uma rota com scope exigido. */
function appWith(verifier: Parameters<typeof createAuthMiddleware>[0]['verifier'], authRequired = true) {
  const app = new Hono<AppEnv>();
  app.use('*', createAuthMiddleware({ verifier, authRequired }));
  app.get('/free', (c) => c.json({ ws: c.get('principal').workspaceId }));
  app.get('/needs-publish', requireScope('skills:publish'), (c) => c.json({ ok: true }));
  return app;
}

const okVerifier = { resolvePrincipal: (t: string) => Promise.resolve(t === 'good' ? principalOf() : null) };

describe('createAuthMiddleware — ordem 401 → 403 → 503', () => {
  it('sem header Authorization devolve 401 quando auth é exigida', async () => {
    const res = await appWith(okVerifier).request('/free');
    expect(res.status).toBe(401);
  });

  it('credencial inválida devolve 401 — mesmo numa rota que exige scope', async () => {
    // O caso que fixa a ordem: sem credencial válida a resposta é 401, NUNCA 403.
    // Um 403 aqui confirmaria que a rota existe e qual scope ela pede.
    const res = await appWith(okVerifier).request('/needs-publish', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('credencial válida com scope insuficiente devolve 403', async () => {
    const res = await appWith(okVerifier).request('/needs-publish', {
      headers: { authorization: 'Bearer good' },
    });
    expect(res.status).toBe(403);
  });

  it('credencial válida com scope suficiente passa', async () => {
    const v = { resolvePrincipal: () => Promise.resolve(principalOf({ scopes: ['skills:admin'] })) };
    const res = await appWith(v).request('/needs-publish', { headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(200);
  });

  it('backend de auth fora do ar devolve 503 — nunca acesso', async () => {
    const v = { resolvePrincipal: () => Promise.reject(new Error('conexão recusada')) };
    const res = await appWith(v).request('/free', { headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(503);
  });

  it('503 vale também nas rotas com scope — indisponível jamais degrada para liberado', async () => {
    const v = { resolvePrincipal: () => Promise.reject(new Error('down')) };
    const res = await appWith(v).request('/needs-publish', { headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(503);
  });

  it('o esquema Bearer é case-insensitive (RFC 6750 § 2.1)', async () => {
    const res = await appWith(okVerifier).request('/free', { headers: { authorization: 'bearer good' } });
    expect(res.status).toBe(200);
  });

  it('o token preserva espaço INTERNO — o middleware não "limpa" o segredo', async () => {
    // Aparar o miolo mudaria o segredo comparado e faria uma chave legítima falhar por
    // "limpeza". Já o espaço nas BORDAS é removido pela camada HTTP antes de chegar aqui
    // (RFC 9110 § 5.5 apara OWS do valor do campo) — comportamento da spec, não nosso, e
    // a primeira versão deste teste afirmava o contrário e reprovou por isso.
    let visto = '';
    const v = {
      resolvePrincipal: (t: string) => {
        visto = t;
        return Promise.resolve(null);
      },
    };
    await appWith(v).request('/free', { headers: { authorization: 'Bearer  a b ' } });
    expect(visto).toBe(' a b');
  });

  it('BRIDGE LEGADO: com auth desligada, colapsa no workspace default', async () => {
    // M12 DoD #3 — permite o M12 entrar sem quebrar quem já usa a API sem credencial.
    // É uma porta aberta por escolha explícita, e o padrão é FECHADO (authRequired=true).
    const res = await appWith(okVerifier, false).request('/free');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ws: DEFAULT_WORKSPACE_ID });
  });

  it('nenhuma resposta de erro revela o token nem o motivo interno', async () => {
    const v = { resolvePrincipal: () => Promise.reject(new Error('senha do banco: hunter2')) };
    const res = await appWith(v).request('/free', { headers: { authorization: 'Bearer segredo-do-cliente' } });
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('segredo-do-cliente');
    expect(body).not.toContain('hunter2');
  });
});

describe('requireScope — matriz scope × verbo (DoD #4)', () => {
  const matrix: readonly (readonly [readonly string[], string, number])[] = [
    [['skills:read'], 'skills:read', 200],
    [['skills:read'], 'skills:write', 403],
    [['skills:write'], 'skills:read', 200],
    [['skills:write'], 'skills:publish', 403],
    [['skills:publish'], 'skills:write', 200],
    [['skills:publish'], 'skills:admin', 403],
    [['skills:admin'], 'skills:publish', 200],
    [[], 'skills:read', 403],
  ];

  it('cobre a matriz inteira, positivos e negativos', async () => {
    const falhas: string[] = [];
    for (const [granted, required, expected] of matrix) {
      const v = { resolvePrincipal: () => Promise.resolve(principalOf({ scopes: granted })) };
      const app = new Hono<AppEnv>();
      app.use('*', createAuthMiddleware({ verifier: v, authRequired: true }));
      app.get('/x', requireScope(required as never), (c) => c.json({ ok: true }));
      const res = await app.request('/x', { headers: { authorization: 'Bearer good' } });
      if (res.status !== expected) {
        falhas.push(`granted=[${granted.join(',')}] required=${required} -> ${String(res.status)} (esperado ${String(expected)})`);
      }
    }
    expect(falhas, `células erradas:\n${falhas.join('\n')}`).toEqual([]);
  });
});
