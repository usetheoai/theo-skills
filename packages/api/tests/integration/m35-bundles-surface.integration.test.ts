import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createAdoptionStore } from '../../src/server/store/adoption-store.js';
import { createBundlesStore } from '../../src/server/store/bundles-store.js';


import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M35 — o contrato que a tela de distribuição precisa.
 *
 * Três lacunas, todas de leitura: não havia como LISTAR tokens (só emitir e revogar), a adoção não
 * devolvia o denominador da janela, e o isolamento entre publishers era estrutural e não provado.
 *
 * O terceiro é o que mais importa. `adoption-store.ts:29-34` afirma que o escopo na construção
 * impede "inclusive o vazamento por diferença de contagem agregada" — uma afirmação de segurança
 * que, até este arquivo, nada verificava. O registry investigado também não a testa: os testes dele
 * provam **atribuição** (a métrica leva o dono certo), não **isolamento** (um dono não lê a do
 * outro). Não havia prior art a copiar.
 */

const WS_A = 'ws_pub_a';
const WS_B = 'ws_pub_b';

const storeFor = (ws: string) => createBundlesStore(createDb(getPool()), ws);

describeIntegration('M35 — superfície de bundles e adoção', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(closePool);

  it('lista os tokens emitidos — sem isso não há o que revogar', async () => {
    const store = storeFor(WS_A);
    const bundleId = await store.create('pacote-a');
    const minted = await store.mintToken(bundleId, { ttlMs: 86_400_000, label: 'ci' });

    const tokens = await store.listTokens(bundleId);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenId).toBe(minted.tokenId);
    expect(tokens[0]?.label).toBe('ci');
  });

  it('a listagem NUNCA devolve o valor do token', async () => {
    // O valor existe em claro uma única vez: na resposta do mint. Devolvê-lo de novo tornaria a
    // listagem uma segunda cópia do cofre — com leitura mais ampla que a criação.
    const store = storeFor(WS_A);
    const bundleId = await store.create('pacote-a');
    const minted = await store.mintToken(bundleId, { ttlMs: 86_400_000 });

    const serializado = JSON.stringify(await store.listTokens(bundleId));

    expect(serializado).not.toContain(minted.token);
  });

  it('a listagem NUNCA devolve o hash — ele é material de ataque offline, e inútil para a tela', async () => {
    const store = storeFor(WS_A);
    const bundleId = await store.create('pacote-a');
    await store.mintToken(bundleId, { ttlMs: 86_400_000 });

    const { rows } = await getPool().query<{ token_hash: string }>(
      'SELECT token_hash FROM distribution_tokens LIMIT 1',
    );
    const hash = rows[0]?.token_hash ?? '';
    expect(hash).not.toBe('');

    const serializado = JSON.stringify(await store.listTokens(bundleId));
    expect(serializado).not.toContain(hash);
  });

  it('bundle sem token devolve lista vazia — ausência de token não é ausência de bundle', async () => {
    const store = storeFor(WS_A);
    const bundleId = await store.create('vazio');

    expect(await store.listTokens(bundleId)).toEqual([]);
  });

  it('o token revogado continua na lista, com a marca — esconder impediria auditar o que foi emitido', async () => {
    const store = storeFor(WS_A);
    const bundleId = await store.create('pacote-a');
    const minted = await store.mintToken(bundleId, { ttlMs: 86_400_000 });
    await store.revokeToken(minted.tokenId);

    const tokens = await store.listTokens(bundleId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it('um publisher NÃO enxerga os tokens de outro', async () => {
    // O isolamento que o comentário do store afirma e que nada provava. Se este teste passar a
    // reprovar, o escopo estrutural foi quebrado — e o vazamento é entre clientes.
    const a = storeFor(WS_A);
    const bundleA = await a.create('pacote-a');
    await a.mintToken(bundleA, { ttlMs: 86_400_000, label: 'segredo-de-a' });

    const b = storeFor(WS_B);
    expect(await b.listTokens(bundleA)).toEqual([]);
  });

  it('a adoção devolve o TOTAL da janela — sem ele a tela calcula o denominador errado', async () => {
    // Somar as linhas recebidas parece equivalente e não é: sob paginação ou top-N, a soma é de um
    // recorte e a proporção sai errada em silêncio, que é o pior modo de errar num gráfico.
    const bundles = storeFor(WS_A);
    const bundleId = await bundles.create('pacote-a');
    const adoption = createAdoptionStore(createDb(getPool()), WS_A);

    for (const skillId of ['s1', 's1', 's2']) {
      await adoption.record({ bundleId, tokenId: 'dtk_x', skillId, revisionId: 'rev_1', version: '1.0.0' });
    }

    const since = new Date(Date.now() - 86_400_000);
    const total = await adoption.totalInstalls(bundleId, since);

    expect(total).toBe(3);
  });

  it('janela sem instalação devolve zero explícito, não campo ausente', async () => {
    // `0` e "não sei" levam a tela a desenhos opostos. O contrato precisa dizer qual dos dois é.
    const bundles = storeFor(WS_A);
    const bundleId = await bundles.create('pacote-a');
    const adoption = createAdoptionStore(createDb(getPool()), WS_A);

    expect(await adoption.totalInstalls(bundleId, new Date(Date.now() - 86_400_000))).toBe(0);
  });

  it('um publisher NÃO enxerga a adoção de outro', async () => {
    const bundlesA = storeFor(WS_A);
    const bundleA = await bundlesA.create('pacote-a');
    const adoptionA = createAdoptionStore(createDb(getPool()), WS_A);
    await adoptionA.record({ bundleId: bundleA, tokenId: 'dtk_x', skillId: 's1', revisionId: 'rev_1', version: '1.0.0' });

    const adoptionB = createAdoptionStore(createDb(getPool()), WS_B);
    const since = new Date(Date.now() - 86_400_000);

    expect(await adoptionB.adoption(bundleA, since)).toEqual([]);
    // O total também precisa isolar: vazamento por contagem agregada é o que o comentário do store
    // afirma impedir, e é o mais fácil de deixar passar — nenhuma linha vaza, só o número.
    expect(await adoptionB.totalInstalls(bundleA, since)).toBe(0);
  });
});
