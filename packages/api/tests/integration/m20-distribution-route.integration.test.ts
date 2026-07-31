import { type AuthVerifier } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createBundlesStore } from '../../src/server/store/bundles-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M20 DoD #3 e #4 — a rota que o cliente do nosso cliente realmente chama.
 *
 * Quem chega aqui não é membro de workspace algum e não tem Principal. Toda a decisão de
 * acesso vem do token de distribuição — e um erro nessa rota não é um bug interno, é um
 * vazamento entre empresas.
 */

const PUB_A = 'ws_pub_a';
const PUB_B = 'ws_pub_b';

describeIntegration('M20 — rota de distribuição', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  const appWith = (distribution = { defaultQuota: 100, windowMs: 60_000 }) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      distribution,
      // Auth interna LIGADA de propósito: prova que a rota de distribuição não depende dela
      // e não é bloqueada por ela.
      authVerifier: { resolvePrincipal: () => Promise.resolve(null) } satisfies AuthVerifier,
    });

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const setup = async () => {
    const a = createBundlesStore(createDb(getPool()), PUB_A);
    const b = createBundlesStore(createDb(getPool()), PUB_B);
    const bundleA = await a.create('pacote-A');
    await a.setItems(bundleA, [{ skillId: 'sk_1', channel: 'stable' }]);
    const bundleB = await b.create('pacote-B');
    await b.setItems(bundleB, [{ skillId: 'sk_9', channel: 'stable' }]);
    return { a, b, bundleA, bundleB };
  };

  const get = (app: ReturnType<typeof appWith>, token?: string) =>
    app.request('/v1/distribution/bundle', token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });

  it('token válido devolve o bundle — mesmo com a auth interna recusando tudo', async () => {
    const { a, bundleA } = await setup();
    const { token } = await a.mintToken(bundleA, { ttlMs: 60_000 });

    const res = await get(appWith(), token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bundle_id: string; skills: { skill_id: string }[] };
    expect(body.bundle_id).toBe(bundleA);
    expect(body.skills.map((s) => s.skill_id)).toEqual(['sk_1']);
  });

  it('a resposta NÃO revela o workspace do publisher', async () => {
    // O cliente final não precisa do identificador interno de quem o atende, e expô-lo daria
    // a ele um dado para correlacionar publishers entre si.
    const { a, bundleA } = await setup();
    const { token } = await a.mintToken(bundleA, { ttlMs: 60_000 });
    const corpo = await (await get(appWith(), token)).text();
    expect(corpo).not.toContain(PUB_A);
  });

  it('sem token: 404 (não 401) — a rota não confirma sequer que existe algo a autenticar', async () => {
    const res = await get(appWith());
    expect(res.status).toBe(404);
  });

  it('token inválido, revogado e expirado: TODOS 404, indistinguíveis entre si', async () => {
    // Distinguir permitiria a um cliente descobrir bundles alheios por tentativa.
    const { a, bundleA } = await setup();
    const app = appWith();

    const { token: revogado, tokenId } = await a.mintToken(bundleA, { ttlMs: 60_000 });
    await a.revokeToken(tokenId);
    const { token: expirado } = await a.mintToken(bundleA, { ttlMs: -1000 });

    for (const [label, tok] of [
      ['inexistente', 'theoskill_dist_nao-existe'],
      ['formato errado', 'qualquer-coisa'],
      ['revogado', revogado],
      ['expirado', expirado],
    ] as const) {
      expect((await get(app, tok)).status, `${label} não deu 404`).toBe(404);
    }
  });

  it('ISOLAMENTO: token de A nunca devolve o bundle de B', async () => {
    const { a, bundleA, bundleB } = await setup();
    const { token } = await a.mintToken(bundleA, { ttlMs: 60_000 });
    const body = (await (await get(appWith(), token)).json()) as { bundle_id: string; skills: { skill_id: string }[] };
    expect(body.bundle_id).not.toBe(bundleB);
    expect(body.skills.map((s) => s.skill_id)).not.toContain('sk_9');
  });

  it('QUOTA: excedeu devolve 429 com Retry-After', async () => {
    const { a, bundleA } = await setup();
    const { token } = await a.mintToken(bundleA, { ttlMs: 60_000, quotaPerWindow: 2 });
    const app = appWith();

    expect((await get(app, token)).status).toBe(200);
    expect((await get(app, token)).status).toBe(200);
    const excedido = await get(app, token);
    expect(excedido.status).toBe(429);
    expect(excedido.headers.get('Retry-After')).not.toBeNull();
  });

  it('QUOTA é POR TOKEN — o excesso de um cliente não pune os outros do mesmo publisher', async () => {
    // É o ponto que separa quota utilizável de quota que gera incidente: um cliente
    // descuidado não pode derrubar o serviço para os demais clientes do mesmo publisher.
    const { a, bundleA } = await setup();
    const { token: t1 } = await a.mintToken(bundleA, { ttlMs: 60_000, quotaPerWindow: 1 });
    const { token: t2 } = await a.mintToken(bundleA, { ttlMs: 60_000, quotaPerWindow: 1 });
    const app = appWith();

    expect((await get(app, t1)).status).toBe(200);
    expect((await get(app, t1)).status).toBe(429);
    expect((await get(app, t2)).status, 'o excesso de t1 puniu t2').toBe(200);
  });

  it('o token usa a quota PADRÃO quando não declara a própria', async () => {
    const { a, bundleA } = await setup();
    const { token } = await a.mintToken(bundleA, { ttlMs: 60_000 });
    const app = appWith({ defaultQuota: 1, windowMs: 60_000 });
    expect((await get(app, token)).status).toBe(200);
    expect((await get(app, token)).status).toBe(429);
  });

  it('distribuição AUSENTE = rota inexistente (404), não erro de servidor', async () => {
    const { a, bundleA } = await setup();
    const { token } = await a.mintToken(bundleA, { ttlMs: 60_000 });
    const app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), reservationHours: 1 });
    expect((await app.request('/v1/distribution/bundle', { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });
});
