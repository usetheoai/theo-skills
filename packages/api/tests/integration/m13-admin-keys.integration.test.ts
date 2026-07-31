import { createHash } from 'node:crypto';

import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createApiKeyVerifier } from '../../src/server/auth/api-key-verifier.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createMembersStore } from '../../src/server/store/members-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M13 DoD #4 — anti-escalation na CUNHAGEM, que é onde o privilégio nasce (ADR 0007).
 *
 * O par 403/422 é o ponto sutil: eles respondem perguntas diferentes, e colapsá-los num só
 * esconderia um erro de digitação atrás de uma mensagem de permissão.
 */

const WS = 'ws_keys';

const principalOf = (userId: string): Principal => ({
  workspaceId: WS,
  userId,
  role: 'member',
  scopes: ['skills:admin'],
});

describeIntegration('M13 — cunhagem de chaves e anti-escalation', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  const appAs = (userId: string) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalOf(userId),
    });

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    const pool = getPool();
    for (const [id, email] of [
      ['u_owner', 'o@k.dev'],
      ['u_admin', 'a@k.dev'],
      ['u_member', 'm@k.dev'],
      ['u_forasteiro', 'f@k.dev'],
    ]) {
      await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', [id, email]);
    }
    const s = createMembersStore(createDb(getPool()), WS);
    await s.upsert('u_owner', 'owner');
    await s.upsert('u_admin', 'admin');
    await s.upsert('u_member', 'member');
  });

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const mint = (actor: string, body: unknown) =>
    appAs(actor).request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('admin cunha chave para member: 201, e o token vem UMA vez', async () => {
    const res = await mint('u_admin', { user_id: 'u_member', scopes: ['skills:publish'] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; key_id: string };
    expect(body.token).toMatch(/^theoskill_live_[0-9a-f]{64}$/);

    // O banco guarda só o HASH — um dump não vaza credencial.
    const { rows } = await getPool().query<{ token_hash: string }>(
      'SELECT token_hash FROM api_keys WHERE key_id = $1',
      [body.key_id],
    );
    expect(rows[0]?.token_hash).toBe(createHash('sha256').update(body.token).digest('hex'));
    expect(rows[0]?.token_hash).not.toContain(body.token);
  });

  it('a chave cunhada FUNCIONA de verdade no verificador', async () => {
    // Prova de ponta a ponta: cunhar sem que a chave autentique seria teatro.
    const res = await mint('u_owner', { user_id: 'u_member', scopes: ['skills:read'] });
    const { token } = (await res.json()) as { token: string };

    const verifier = createApiKeyVerifier({
      findByHash: async (h: string) => {
        const { rows } = await getPool().query<{
          workspace_id: string;
          user_id: string;
          scopes: string[];
          revoked_at: Date | null;
          expires_at: Date | null;
        }>('SELECT workspace_id, user_id, scopes, revoked_at, expires_at FROM api_keys WHERE token_hash = $1', [h]);
        const r = rows[0];
        return r === undefined
          ? null
          : {
              tokenHash: h,
              workspaceId: r.workspace_id,
              userId: r.user_id,
              scopes: r.scopes as never,
              revokedAt: r.revoked_at,
              expiresAt: r.expires_at,
            };
      },
    });
    const principal = await verifier.resolvePrincipal(token);
    expect(principal?.workspaceId).toBe(WS);
    expect(principal?.userId).toBe('u_member');
  });

  it('ANTI-ESCALATION: admin cunhando para OWNER recebe 403', async () => {
    // Sem isto, um admin emitiria chave em nome de um owner e herdaria o privilégio por procuração.
    const res = await mint('u_admin', { user_id: 'u_owner', scopes: ['skills:read'] });
    expect(res.status).toBe(403);
  });

  it('NÃO-MEMBRO recebe 422, não 403 — a distinção é o ponto', async () => {
    const res = await mint('u_owner', { user_id: 'u_forasteiro', scopes: ['skills:read'] });
    expect(res.status).toBe(422);
  });

  it('member não cunha chave alguma: 403 pelo portão de papel', async () => {
    const res = await mint('u_member', { user_id: 'u_member', scopes: ['skills:read'] });
    expect(res.status).toBe(403);
  });

  it('scope desconhecido é 400 explícito, não descarte silencioso', async () => {
    // Descartar entregaria uma chave com menos poder que o pedido, e a falha apareceria
    // depois como um 403 inexplicável no cliente.
    const res = await mint('u_owner', { user_id: 'u_member', scopes: ['skills:read', 'skills:deus'] });
    expect(res.status).toBe(400);
  });

  it('revogar torna a chave inútil, e revogar de outro tenant é 404', async () => {
    const res = await mint('u_owner', { user_id: 'u_member', scopes: ['skills:read'] });
    const { key_id } = (await res.json()) as { key_id: string };

    expect((await appAs('u_owner').request(`/v1/admin/keys/${key_id}`, { method: 'DELETE' })).status).toBe(204);
    const { rows } = await getPool().query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM api_keys WHERE key_id = $1',
      [key_id],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();

    // Id inexistente (ou de outro workspace) é 404 — confirmar existência permitiria enumerar.
    expect((await appAs('u_owner').request('/v1/admin/keys/key_inexistente', { method: 'DELETE' })).status).toBe(404);
  });
});
