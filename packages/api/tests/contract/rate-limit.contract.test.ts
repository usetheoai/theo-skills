import { type Principal } from '@usetheo/skills';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../../src/server/middleware/rate-limit.js';
import { type AppEnv } from '../../src/server/principal-context.js';

/**
 * M17 DoD #2 — rate limiting por principal.
 *
 * O risco declarado do milestone é "rate limit sem backpressure coerente derruba cliente
 * legítimo". A mitigação é o `Retry-After`: sem ele o cliente não sabe quando voltar, retenta
 * imediatamente, e o limite vira amplificador de carga em vez de contenção.
 */

const p = (workspaceId: string, userId: string | null): Principal => ({
  workspaceId,
  userId,
  role: 'member',
  scopes: ['skills:admin'],
});

function appFor(principal: Principal, config: { read: number; write: number; windowMs: number }, clock: { t: number }) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('principal', principal);
    await next();
  });
  app.use('*', createRateLimiter({ config, now: () => clock.t }));
  app.get('/r', (c) => c.json({ ok: true }));
  app.post('/w', (c) => c.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  it('permite até o limite e bloqueia a partir da requisição seguinte', async () => {
    const clock = { t: 1000 };
    const app = appFor(p('ws', 'u'), { read: 3, write: 1, windowMs: 60_000 }, clock);
    for (let i = 0; i < 3; i += 1) {
      expect((await app.request('/r')).status, `req ${String(i + 1)} deveria passar`).toBe(200);
    }
    expect((await app.request('/r')).status).toBe(429);
  });

  it('429 carrega Retry-After — sem ele o limite vira amplificador de carga', async () => {
    const clock = { t: 0 };
    const app = appFor(p('ws', 'u'), { read: 1, write: 1, windowMs: 30_000 }, clock);
    await app.request('/r');
    const res = await app.request('/r');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(((await res.json()) as { retry_after_seconds: number }).retry_after_seconds).toBe(30);
  });

  it('leitura e escrita têm ORÇAMENTOS SEPARADOS', async () => {
    // Uma leitura é uma consulta; uma escrita enfileira trabalho, gera embedding e dispara
    // webhook. Compartilhar orçamento faria um cliente de leitura intensa bloquear a própria
    // publicação — e vice-versa.
    const clock = { t: 0 };
    const app = appFor(p('ws', 'u'), { read: 1, write: 1, windowMs: 60_000 }, clock);
    expect((await app.request('/r')).status).toBe(200);
    expect((await app.request('/w', { method: 'POST' })).status).toBe(200);
    expect((await app.request('/r')).status).toBe(429);
    expect((await app.request('/w', { method: 'POST' })).status).toBe(429);
  });

  it('a janela REABRE depois de expirar', async () => {
    const clock = { t: 0 };
    const app = appFor(p('ws', 'u'), { read: 1, write: 1, windowMs: 1000 }, clock);
    expect((await app.request('/r')).status).toBe(200);
    expect((await app.request('/r')).status).toBe(429);
    clock.t = 1001;
    expect((await app.request('/r')).status).toBe(200);
  });

  it('principais DIFERENTES não compartilham orçamento', async () => {
    const clock = { t: 0 };
    const cfg = { read: 1, write: 1, windowMs: 60_000 };
    const a = appFor(p('ws', 'u_a'), cfg, clock);
    const b = appFor(p('ws', 'u_b'), cfg, clock);
    expect((await a.request('/r')).status).toBe(200);
    expect((await a.request('/r')).status).toBe(429);
    // `b` tem o próprio orçamento — o excesso de `a` não o pune.
    expect((await b.request('/r')).status).toBe(200);
  });

  it('WORKSPACES diferentes não compartilham orçamento nem com userId igual', async () => {
    // Um `userId` vindo de OIDC pode colidir com outro de um tenant distinto. Se a chave do
    // bucket ignorasse o workspace, um cliente limitaria o outro.
    const clock = { t: 0 };
    const cfg = { read: 1, write: 1, windowMs: 60_000 };
    const a = appFor(p('ws_A', 'mesmo_id'), cfg, clock);
    const b = appFor(p('ws_B', 'mesmo_id'), cfg, clock);
    await a.request('/r');
    expect((await a.request('/r')).status).toBe(429);
    expect((await b.request('/r')).status).toBe(200);
  });

  it('userId null (credencial de workspace) não colapsa com outro tenant', async () => {
    const clock = { t: 0 };
    const cfg = { read: 1, write: 1, windowMs: 60_000 };
    const a = appFor(p('ws_A', null), cfg, clock);
    const b = appFor(p('ws_B', null), cfg, clock);
    await a.request('/r');
    expect((await a.request('/r')).status).toBe(429);
    expect((await b.request('/r')).status).toBe(200);
  });

  it('expõe X-RateLimit-Remaining para o cliente se autorregular', async () => {
    const clock = { t: 0 };
    const app = appFor(p('ws', 'u'), { read: 2, write: 1, windowMs: 60_000 }, clock);
    expect((await app.request('/r')).headers.get('X-RateLimit-Remaining')).toBe('1');
    expect((await app.request('/r')).headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});
