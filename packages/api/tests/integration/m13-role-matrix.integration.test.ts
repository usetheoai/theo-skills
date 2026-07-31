import { type Principal, type WorkspaceRole } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createMembersStore } from '../../src/server/store/members-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M13 DoD #5 — matriz papel × rota, e o anti-escalation do DoD #4.
 *
 * A decisão de fundo está no ADR 0007: administrar membros é PERTENCIMENTO (papel), publicar
 * é CAPACIDADE (scope). Estas rotas são as de pertencimento, e o portão delas é `admin`.
 */

const WS = 'ws_matrix';

const principalOf = (userId: string): Principal => ({
  workspaceId: WS,
  userId,
  role: 'member', // irrelevante de propósito: o papel efetivo vem da TABELA, não do token
  scopes: ['skills:admin'],
});

describeIntegration('M13 — matriz papel × rota + anti-escalation', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  const appAs = (userId: string) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalOf(userId),
    });

  const store = () => createMembersStore(createDb(getPool()), WS);

  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    for (const [id, email] of [
      ['u_owner', 'o@x.dev'],
      ['u_admin', 'a@x.dev'],
      ['u_member', 'm@x.dev'],
      ['u_estranho', 'e@x.dev'],
      ['u_alvo', 't@x.dev'],
    ]) {
      await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', [id, email]);
    }
    const s = store();
    await s.upsert('u_owner', 'owner');
    await s.upsert('u_admin', 'admin');
    await s.upsert('u_member', 'member');
    await s.upsert('u_alvo', 'member');
    // `u_estranho` NÃO é membro — é o caso de default-deny.
  });

  beforeEach(async () => {
    boss ??= await startBoss();
  });

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('MATRIZ: só admin+ alcança as rotas de membros', async () => {
    const casos: readonly (readonly [string, string, string, number])[] = [
      ['owner   GET', 'u_owner', 'GET', 200],
      ['admin   GET', 'u_admin', 'GET', 200],
      ['member  GET', 'u_member', 'GET', 403],
      ['estranho GET', 'u_estranho', 'GET', 403],
    ];
    const falhas: string[] = [];
    for (const [label, user, method, esperado] of casos) {
      const res = await appAs(user).request('/v1/members', { method });
      if (res.status !== esperado) falhas.push(`${label} -> ${String(res.status)} (esperado ${String(esperado)})`);
    }
    expect(falhas, `células erradas:\n${falhas.join('\n')}`).toEqual([]);
  });

  it('DEFAULT-DENY: quem não é membro recebe 403 mesmo com scope admin no token', async () => {
    // O token de `u_estranho` carrega `skills:admin`. Se o papel viesse do token em vez da
    // tabela, ele administraria o workspace — e um provedor OIDC externo passaria a decidir
    // quem manda aqui dentro.
    const res = await appAs('u_estranho').request('/v1/members');
    expect(res.status).toBe(403);
  });

  it('ANTI-ESCALATION: admin não se promove a owner', async () => {
    const res = await appAs('u_admin').request('/v1/members', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'u_admin', role: 'owner' }),
    });
    expect(res.status).toBe(403);
    expect(await store().roleOf('u_admin')).toBe('admin');
  });

  it('ANTI-ESCALATION: admin não altera um owner', async () => {
    const res = await appAs('u_admin').request('/v1/members/u_owner', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(res.status).toBe(403);
    expect(await store().roleOf('u_owner')).toBe('owner');
  });

  it('admin PROMOVE um member a admin (o teto é o próprio papel, não a paralisia)', async () => {
    // Contraprova: um anti-escalation que recusasse tudo passaria nos dois testes acima.
    const res = await appAs('u_admin').request('/v1/members/u_alvo', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);
    expect(await store().roleOf('u_alvo')).toBe('admin');
  });

  it('alvo que não é membro devolve 404 — não 403 (não confirma existência)', async () => {
    const res = await appAs('u_owner').request('/v1/members/u_estranho', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(res.status).toBe(404);
  });

  it('demover o último owner pela ROTA devolve 409, e o owner permanece', async () => {
    // O invariante do store chegando à superfície HTTP com o código certo.
    await store().changeRole('u_alvo', 'member');
    const res = await appAs('u_owner').request('/v1/members/u_owner', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(res.status).toBe(409);
    expect(await store().roleOf('u_owner')).toBe('owner');
  });

  it('remover membro comum funciona e devolve 204', async () => {
    const res = await appAs('u_owner').request('/v1/members/u_alvo', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await store().roleOf('u_alvo')).toBeNull();
  });

  it('corpo inválido devolve 400 — antes de qualquer verificação de papel', async () => {
    const res = await appAs('u_owner').request('/v1/members', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'imperador' }),
    });
    expect(res.status).toBe(400);
  });
});

export type { WorkspaceRole };
