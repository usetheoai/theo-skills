import { createId } from '@paralleldrive/cuid2';
import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createMembersStore } from '../../src/server/store/members-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M14 DoD #3 e #4 — promoção auditada, com proveniência, e reversível.
 *
 * Promover a `public` não é publicar conteúdo: é publicar **código executável** para o agente
 * de outro tenant. É o risco #1 do milestone, e o que distingue este registry do theo-memory
 * — memória é texto; skill é instrução.
 */

const WS = 'ws_promo';
const OUTRO = 'ws_outro';

const principalOf = (userId: string, ws = WS): Principal => ({
  workspaceId: ws,
  userId,
  role: 'member',
  scopes: ['skills:admin'],
});

describeIntegration('M14 — promoção de visibilidade', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;
  let skillId = '';

  const appAs = (userId: string, ws = WS) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalOf(userId, ws),
    });

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    const pool = getPool();
    for (const [id, email] of [
      ['u_admin', 'a@p.dev'],
      ['u_member', 'm@p.dev'],
    ]) {
      await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', [id, email]);
    }
    const s = createMembersStore(createDb(getPool()), WS);
    await s.upsert('u_admin', 'admin');
    await s.upsert('u_member', 'member');

    skillId = `sk_${createId()}`;
    await pool.query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
       VALUES ($1,$2,'promovivel','d','rev_1','promovivel d')`,
      [WS, skillId],
    );
  });

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const setVis = (user: string, vis: string, ws = WS, id = skillId) =>
    appAs(user, ws).request(`/v1/skills/${id}/visibility`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: vis }),
    });

  it('admin promove a public, e a PROVENIÊNCIA é gravada na mesma escrita', async () => {
    const res = await setVis('u_admin', 'public');
    expect(res.status).toBe(200);

    const { rows } = await getPool().query<{ visibility: string; published_by: string; published_at: Date }>(
      'SELECT visibility, published_by, published_at FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [WS, skillId],
    );
    expect(rows[0]?.visibility).toBe('public');
    expect(rows[0]?.published_by).toBe('u_admin');
    expect(rows[0]?.published_at).not.toBeNull();
  });

  it('MEMBER não promove — curadoria é explícita, não auto-publicação', async () => {
    const res = await setVis('u_member', 'public');
    expect(res.status).toBe(403);
    const { rows } = await getPool().query<{ visibility: string }>(
      'SELECT visibility FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [WS, skillId],
    );
    expect(rows[0]?.visibility).toBe('private');
  });

  it('REVERSÍVEL: voltar a private limpa a proveniência', async () => {
    // Manter a proveniência afirmaria que a skill está publicada por alguém quando ela não
    // está mais publicada por ninguém.
    await setVis('u_admin', 'public');
    const res = await setVis('u_admin', 'private');
    expect(res.status).toBe(200);

    const { rows } = await getPool().query<{ visibility: string; published_by: string | null }>(
      'SELECT visibility, published_by FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [WS, skillId],
    );
    expect(rows[0]?.visibility).toBe('private');
    expect(rows[0]?.published_by).toBeNull();
  });

  it('visibilidade inválida é 400, e não altera nada', async () => {
    const res = await setVis('u_admin', 'super-publica');
    expect(res.status).toBe(400);
    const { rows } = await getPool().query<{ visibility: string }>(
      'SELECT visibility FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [WS, skillId],
    );
    expect(rows[0]?.visibility).toBe('private');
  });

  it('skill de OUTRO workspace responde 404, não 403', async () => {
    // Mesmo contrato de enumeração do M11: 403 confirmaria que a skill existe.
    const pool = getPool();
    await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', ['u_x', 'x@p.dev']);
    await createMembersStore(createDb(pool), OUTRO).upsert('u_x', 'admin');
    const res = await setVis('u_x', 'public', OUTRO);
    expect(res.status).toBe(404);
  });

  it('PROVENIÊNCIA de skill pública é consultável por outro tenant', async () => {
    await setVis('u_admin', 'public');
    const pool = getPool();
    await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', ['u_ext', 'e@p.dev']);

    const res = await appAs('u_ext', OUTRO).request(`/v1/skills/${skillId}/provenance`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published_by: string; origin: string };
    expect(body.published_by).toBe('u_admin');
    // O consumidor precisa saber que é código de fora ANTES de instalar.
    expect(body.origin).toBe('public');
  });

  it('proveniência de skill PRIVADA alheia é 404 — não vira porta lateral', async () => {
    // Sem esta guarda, a rota de proveniência revelaria a existência do que o isolamento
    // esconde.
    const pool = getPool();
    await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', ['u_ext2', 'e2@p.dev']);
    const res = await appAs('u_ext2', OUTRO).request(`/v1/skills/${skillId}/provenance`);
    expect(res.status).toBe(404);
  });
});
