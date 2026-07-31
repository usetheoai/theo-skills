import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createBundlesStore, createDistributionResolver } from '../../src/server/store/bundles-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M20 — distribuição para clientes de terceiros (bundles + tokens delegados).
 *
 * É o milestone que responde ao pedido de origem: um publisher (nosso cliente) empacota um
 * subconjunto do catálogo dele e distribui aos CLIENTES DELE, que consomem direto do nosso
 * registry com credencial que **o publisher** emite e revoga.
 *
 * O teste de isolamento cruzado é o coração: o M11 isolou workspaces NOSSOS; aqui cada
 * workspace passa a ter N consumidores externos, e um vazamento deixa de ser bug interno
 * para virar incidente entre empresas.
 */

const PUB_A = 'ws_publisher_a';
const PUB_B = 'ws_publisher_b';

describeIntegration('M20 — bundles e tokens de distribuição', () => {
  const storeA = () => createBundlesStore(createDb(getPool()), PUB_A);
  const storeB = () => createBundlesStore(createDb(getPool()), PUB_B);
  const resolver = (now?: () => Date) => createDistributionResolver(createDb(getPool()), now);

  beforeEach(truncateAll);
  afterAll(closePool);

  it('bundle referencia skills por CANAL, não por revisão fixa', async () => {
    // Fixar revisão obrigaria o publisher a reemitir credenciais a cada correção — e ninguém
    // faria isso, então as correções não chegariam aos clientes dele.
    const s = storeA();
    const id = await s.create('pacote-basico');
    await s.setItems(id, [
      { skillId: 'sk_1', channel: 'stable' },
      { skillId: 'sk_2', channel: 'beta' },
    ]);
    const b = await s.get(id);
    expect(b?.name).toBe('pacote-basico');
    expect(b?.items).toEqual([
      { skillId: 'sk_1', channel: 'stable' },
      { skillId: 'sk_2', channel: 'beta' },
    ]);
  });

  it('token resolve para a concessão: workspace + bundle DESCOBERTOS, não informados', async () => {
    // Quem apresenta o token é o cliente de um publisher que ainda não sabemos qual é.
    // Descobrir o workspace é o RESULTADO da resolução, não uma entrada dela.
    const s = storeA();
    const bundleId = await s.create('p1');
    const { token, tokenId } = await s.mintToken(bundleId, { ttlMs: 60_000 });

    const grant = await resolver().resolve(token);
    expect(grant).toMatchObject({ tokenId, workspaceId: PUB_A, bundleId });
  });

  it('ISOLAMENTO CRUZADO: token do publisher A nunca alcança bundle do publisher B', async () => {
    const a = storeA();
    const b = storeB();
    const bundleA = await a.create('de-A');
    const bundleB = await b.create('de-B');
    const { token: tokenA } = await a.mintToken(bundleA, { ttlMs: 60_000 });

    const grant = await resolver().resolve(tokenA);
    expect(grant?.workspaceId).toBe(PUB_A);
    expect(grant?.bundleId).toBe(bundleA);
    expect(grant?.bundleId, 'token de A resolveu para bundle de B').not.toBe(bundleB);

    // E o store de B não enxerga nada de A.
    expect(await b.get(bundleA)).toBeNull();
    expect((await b.list()).map((x) => x.bundleId)).toEqual([bundleB]);
  });

  it('token REVOGADO deixa de valer imediatamente', async () => {
    const s = storeA();
    const bundleId = await s.create('p');
    const { token, tokenId } = await s.mintToken(bundleId, { ttlMs: 60_000 });
    expect(await resolver().resolve(token)).not.toBeNull();

    expect(await s.revokeToken(tokenId)).toBe(true);
    expect(await resolver().resolve(token)).toBeNull();
  });

  it('EXPIRAÇÃO é obrigatória e respeitada', async () => {
    // Ao contrário das chaves internas, `expiresAt` não é opcional aqui: credencial de
    // terceiro sem prazo é a que ninguém lembra de revogar, e sobrevive à relação comercial.
    const s = storeA();
    const bundleId = await s.create('p');
    const { token, expiresAt } = await s.mintToken(bundleId, { ttlMs: 1000 });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const depois = new Date(Date.now() + 2000);
    expect(await resolver(() => depois).resolve(token)).toBeNull();
  });

  it('publisher B não revoga token de A', async () => {
    const a = storeA();
    const bundleId = await a.create('p');
    const { token, tokenId } = await a.mintToken(bundleId, { ttlMs: 60_000 });

    expect(await storeB().revokeToken(tokenId), 'B revogou token de A').toBe(false);
    expect(await resolver().resolve(token), 'token de A foi invalidado por B').not.toBeNull();
  });

  it('token inexistente, de formato errado e vazio devolvem null (o handler traduz em 404)', async () => {
    // 404 e não 403: confirmar que o token existe mas não serve permitiria descobrir bundles
    // de outro publisher por tentativa.
    const r = resolver();
    expect(await r.resolve('theoskill_dist_inexistente')).toBeNull();
    expect(await r.resolve('bearer-qualquer')).toBeNull();
    expect(await r.resolve('')).toBeNull();
  });

  it('o token cru NÃO é recuperável — o banco guarda só o hash', async () => {
    const s = storeA();
    const bundleId = await s.create('p');
    const { token, tokenId } = await s.mintToken(bundleId, { ttlMs: 60_000 });
    const { rows } = await getPool().query<{ token_hash: string }>(
      'SELECT token_hash FROM distribution_tokens WHERE token_id = $1',
      [tokenId],
    );
    expect(rows[0]?.token_hash).not.toContain(token);
    expect(rows[0]?.token_hash).toHaveLength(64);
  });

  it('substituir os itens do bundle não afeta os tokens já emitidos', async () => {
    // É a propriedade que faz o modelo funcionar: corrigir o catálogo propaga sem reemitir
    // credencial alguma.
    const s = storeA();
    const bundleId = await s.create('p');
    const { token } = await s.mintToken(bundleId, { ttlMs: 60_000 });
    await s.setItems(bundleId, [{ skillId: 'sk_1', channel: 'stable' }]);
    await s.setItems(bundleId, [{ skillId: 'sk_9', channel: 'stable' }]);

    const grant = await resolver().resolve(token);
    expect(grant?.bundleId).toBe(bundleId);
    expect((await s.get(bundleId))?.items).toEqual([{ skillId: 'sk_9', channel: 'stable' }]);
  });
});
