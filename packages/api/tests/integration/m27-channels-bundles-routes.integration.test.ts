import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createMembersStore } from '../../src/server/store/members-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M27 — as rotas que faltavam: CANAIS e BUNDLES.
 *
 * Os dois stores existiam completos e **sem chamador de produção**: canal existia só no
 * store, e `createBundlesStore` só era invocado por teste. Um publisher não conseguia criar
 * um bundle por meio suportado — a distribuição inteira era inalcançável, e o marco estava
 * marcado como entregue.
 */

const WS = 'ws_rotas';

const principalDe = (userId: string, scopes: Principal['scopes']): Principal => ({
  workspaceId: WS,
  userId,
  role: 'member',
  scopes,
});

describeIntegration('M27 — rotas de canal e de bundle', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    const pool = getPool();
    for (const [id, email] of [['u_admin', 'a@p.dev'], ['u_leitor', 'l@p.dev']]) {
      await pool.query('INSERT INTO users (user_id,email) VALUES ($1,$2)', [id, email]);
    }
    const membros = createMembersStore(createDb(pool), WS);
    await membros.upsert('u_admin', 'admin');
    await membros.upsert('u_leitor', 'member');

    // Duas revisões versionadas: a lista de versões e a promoção de canal precisam de mais
    // de uma para provar qualquer coisa.
    const skills = createSkillsStore(createDb(pool), WS);
    await skills.createWithRevision({
      skillId: 'vendas', name: 'vendas', description: 'd',
      payload: Buffer.from('z'), contentHash: 'h-1.0.0',
      frontmatter: {}, skillMd: '#', version: '1.0.0',
    });
    await skills.addRevision('vendas', {
      payload: Buffer.from('z'), contentHash: 'h-1.1.0',
      frontmatter: {}, skillMd: '#', version: '1.1.0',
    });
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const app = (userId = 'u_admin', scopes: Principal['scopes'] = ['skills:admin']) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      distribution: { defaultQuota: 100, windowMs: 60_000 },
      principalResolver: () => principalDe(userId, scopes),
    });

  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // ---- CANAIS -------------------------------------------------------------------------

  it('lista as versões de uma skill — o que `isNotNull(version)` descartava', async () => {
    const res = await app().request('/v1/skills/vendas/versions');
    expect(res.status).toBe(200);
    const b = (await res.json()) as { versions: { version: string }[] };
    expect(b.versions.map((v) => v.version).sort()).toEqual(['1.0.0', '1.1.0']);
  });

  it('promove uma revisão a um canal, e o canal passa a apontar para ela', async () => {
    const { rows } = await getPool().query<{ revision_id: string }>(
      "SELECT revision_id FROM skill_revisions WHERE workspace_id=$1 AND version='1.0.0'",
      [WS],
    );
    const rev = rows[0]!.revision_id;

    const put = await app().request('/v1/skills/vendas/channels/stable', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision_id: rev }),
    });
    expect(put.status).toBe(200);

    const get = await app().request('/v1/skills/vendas/channels');
    const b = (await get.json()) as { channels: { channel: string; revision_id: string }[] };
    expect(b.channels.find((c) => c.channel === 'stable')?.revision_id).toBe(rev);
  });

  it('promover exige escopo de PUBLICAÇÃO — leitura não move canal', async () => {
    // Canal é o que um consumidor segue: mover um aponta todos os clientes para outro
    // conteúdo. É publicação, não escrita comum.
    const res = await app('u_leitor', ['skills:read']).request('/v1/skills/vendas/channels/stable', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision_id: 'rev_qualquer' }),
    });
    expect(res.status).toBe(403);
  });

  it('canal de skill inexistente é 404, nunca cria', async () => {
    const res = await app().request('/v1/skills/nao-existe/channels');
    expect(res.status).toBe(404);
  });

  // ---- BUNDLES ------------------------------------------------------------------------

  it('cria bundle, define itens e cunha credencial — a jornada do publisher', async () => {
    const criar = await app().request('/v1/bundles', json({ name: 'pacote-do-cliente' }));
    expect(criar.status).toBe(201);
    const { bundle_id } = (await criar.json()) as { bundle_id: string };

    const itens = await app().request(`/v1/bundles/${bundle_id}/items`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ skill_id: 'vendas', channel: 'stable' }] }),
    });
    expect(itens.status).toBe(200);

    const token = await app().request(`/v1/bundles/${bundle_id}/tokens`, json({ ttl_days: 30, label: 'cliente-a' }));
    expect(token.status).toBe(201);
    const t = (await token.json()) as { token: string; expires_at: string };
    expect(t.token, 'o segredo é devolvido uma única vez').toBeTruthy();
    expect(t.expires_at, 'credencial de terceiro SEM prazo é a que ninguém revoga').toBeTruthy();
  });

  it('criar bundle exige escopo de publicação', async () => {
    const res = await app('u_leitor', ['skills:read']).request('/v1/bundles', json({ name: 'x' }));
    expect(res.status).toBe(403);
  });

  it('cunhar credencial SEM prazo é recusado — o prazo é obrigatório aqui', async () => {
    // Diferente das chaves internas: credencial entregue a terceiro sem validade é a que
    // sobrevive à relação comercial que a justificava.
    const criar = await app().request('/v1/bundles', json({ name: 'p2' }));
    const { bundle_id } = (await criar.json()) as { bundle_id: string };
    const res = await app().request(`/v1/bundles/${bundle_id}/tokens`, json({ label: 'sem-prazo' }));
    expect(res.status).toBe(400);
  });

  it('bundle de OUTRO inquilino é 404 — nunca 403', async () => {
    const criar = await app().request('/v1/bundles', json({ name: 'meu' }));
    const { bundle_id } = (await criar.json()) as { bundle_id: string };

    const alheio = createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      distribution: { defaultQuota: 100, windowMs: 60_000 },
      principalResolver: (): Principal => ({ workspaceId: 'ws_outro', userId: 'u_x', role: 'admin', scopes: ['skills:admin'] }),
    });
    expect((await alheio.request(`/v1/bundles/${bundle_id}/items`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    })).status).toBe(404);
  });
});
