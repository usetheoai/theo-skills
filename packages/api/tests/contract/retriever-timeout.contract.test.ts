import { describe, expect, it } from 'vitest';

import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';

/**
 * O teto pertence à camada de SELEÇÃO, não a uma estratégia.
 *
 * Ele nasceu dentro do híbrido, por perna — e ali resolve o caso de degradação parcial: uma
 * perna cai, a outra responde. Mas `strategy=vector` não passava por teto algum e seguia em
 * ~10 s, medido ao vivo pelo live-test.
 *
 * A causa não é o valor errado: é o LUGAR. Com o teto por estratégia, cada uma precisa
 * lembrar de aplicá-lo, e a próxima esquece igual — acabou de acontecer. Na seleção, qualquer
 * retriever escolhido ganha teto de uma vez, e a classe "estratégia nova nasce sem teto"
 * deixa de existir.
 *
 * Os dois tetos coexistem porque respondem a perguntas diferentes:
 *   • por perna (dentro do híbrido) — degradação PARCIAL: a metade viva ainda responde.
 *   • por requisição (na seleção)   — falha RÁPIDA quando não há plano B.
 */
const lento = { retrieve: () => new Promise<never>(() => undefined) };
const rapido = { retrieve: () => Promise.resolve([]) };

describe('teto por requisição, na camada de seleção', () => {
  it('estratégia ÚNICA e lenta falha rápido — não pendura o cliente', async () => {
    const d = createDispatchingRetriever({
      executor: { query: () => Promise.resolve([]) },
      embedder: { provider: 'stub', model: 'stub', embed: () => Promise.resolve([]), embedBatch: () => Promise.resolve([]) },
      workspaceId: 'ws',
      timeoutMs: 80,
      overrides: { vector: lento, keyword: rapido, hybrid: rapido },
    } as never);

    const t0 = Date.now();
    await expect(d.retrieve({ query: 'x', topK: 5, strategy: 'vector' })).rejects.toThrow();
    expect(Date.now() - t0, 'falhou no teto, não pendurou').toBeLessThan(800);
  });

  it('estratégia rápida não é afetada', async () => {
    const d = createDispatchingRetriever({
      executor: { query: () => Promise.resolve([]) },
      embedder: { provider: 'stub', model: 'stub', embed: () => Promise.resolve([]), embedBatch: () => Promise.resolve([]) },
      workspaceId: 'ws',
      timeoutMs: 80,
      overrides: { vector: rapido, keyword: rapido, hybrid: rapido },
    } as never);
    await expect(d.retrieve({ query: 'x', topK: 5, strategy: 'keyword' })).resolves.toEqual([]);
  });
});
