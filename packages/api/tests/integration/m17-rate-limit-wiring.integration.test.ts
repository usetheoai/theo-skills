import { type AuthVerifier, type Principal } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M17 DoD #2 — o rate limit LIGADO, nos dois caminhos de resolução de principal.
 *
 * Este teste existe por causa de um erro real: a primeira versão do wiring colocou o limiter
 * logo após o middleware de auth, e sem `authVerifier` o principal só é setado no middleware
 * seguinte — o limiter leria `undefined` e quebraria justamente a configuração legada que
 * deveria proteger. O caminho legado é o mais fácil de esquecer, então é o primeiro aqui.
 */

const principal: Principal = { workspaceId: 'ws_rl', userId: 'u_rl', role: 'member', scopes: ['skills:admin'] };

describeIntegration('M17 — rate limit ligado ao app', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeAll(async () => {
    boss = await startBoss();
    await truncateAll();
  }, 60_000);

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const base = { pool: getPool(), logger: createNoopLogger(), reservationHours: 1 };

  it('CAMINHO LEGADO (sem authVerifier): o limite vale e devolve 429 + Retry-After', async () => {
    const app = createApp({
      ...base,
      queue: boss,
      rateLimit: { read: 2, write: 1, windowMs: 60_000 },
    });
    expect((await app.request('/v1/skills')).status).toBe(200);
    expect((await app.request('/v1/skills')).status).toBe(200);
    const excedido = await app.request('/v1/skills');
    expect(excedido.status).toBe(429);
    expect(excedido.headers.get('Retry-After')).not.toBeNull();
  });

  it('CAMINHO AUTENTICADO: o orçamento é do principal da credencial', async () => {
    const verifier: AuthVerifier = {
      resolvePrincipal: (t: string) =>
        Promise.resolve(t === 'tok' ? principal : t === 'tok2' ? { ...principal, userId: 'outro' } : null),
    };
    const app = createApp({
      ...base,
      queue: boss,
      authVerifier: verifier,
      rateLimit: { read: 1, write: 1, windowMs: 60_000 },
    });
    const h = (tok: string) => ({ headers: { authorization: `Bearer ${tok}` } });

    expect((await app.request('/v1/skills', h('tok'))).status).toBe(200);
    expect((await app.request('/v1/skills', h('tok'))).status).toBe(429);
    // Credencial DIFERENTE tem orçamento próprio — o excesso de um não pune o outro.
    expect((await app.request('/v1/skills', h('tok2'))).status).toBe(200);
  });

  it('sem credencial o 401 vem ANTES do rate limit — não se gasta orçamento de quem não entrou', async () => {
    // Se o limiter contasse requisições não autenticadas, um atacante sem credencial
    // esgotaria o orçamento de um principal que ele nem sabe qual é.
    const verifier: AuthVerifier = { resolvePrincipal: () => Promise.resolve(null) };
    const app = createApp({ ...base, queue: boss, authVerifier: verifier, rateLimit: { read: 1, write: 1, windowMs: 60_000 } });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.request('/v1/skills')).status).toBe(401);
    }
  });

  it('rate limit AUSENTE = desligado (padrão) — não derruba quem não configurou', async () => {
    const app = createApp({ ...base, queue: boss });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.request('/v1/skills')).status).toBe(200);
    }
  });

  it('as rotas públicas de monitoramento NÃO são limitadas', async () => {
    // Elas são registradas antes de qualquer middleware. Um painel de status que apanhasse
    // do rate limit reportaria o serviço como fora do ar — a mesma classe de mentira que o
    // painel existe para combater.
    const app = createApp({ ...base, queue: boss, rateLimit: { read: 1, write: 1, windowMs: 60_000 } });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.request('/v1/health')).status).toBe(200);
      expect((await app.request('/v1/version')).status).toBe(200);
    }
  });
});
