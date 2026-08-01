import { describe, expect, it } from 'vitest';

import { type EmbeddingProvider } from '../embedders/index.js';

import { type QueryExecutor } from './types.js';
import { createVectorRetriever } from './vector-retriever.js';

/**
 * O VETOR SÓ É COMPARÁVEL DENTRO DO SEU PRÓPRIO ESPAÇO.
 *
 * A consulta é embutida pelo provider ATIVO. Comparar o vetor resultante com um vetor
 * gravado por OUTRO modelo não é uma aproximação ruim — é uma operação sem significado:
 * as dimensões não representam as mesmas coisas.
 *
 * O upsert de embeddings é chaveado por `(revisão, provider, model)`, então trocar de
 * provider NÃO substitui o vetor antigo: ele permanece na tabela. Sem este filtro, a
 * mesma skill entra duas vezes na busca — uma com um vetor real e outra com um de um
 * modelo aposentado — e a linha sem sentido pode ganhar da certa, com um score que parece
 * legítimo.
 *
 * Medido em 2026-07-31: ao ligar o provider real no serviço, as linhas de `stub`
 * continuaram na tabela ao lado das novas.
 */
describe('createVectorRetriever', () => {
  it('restringe a busca ao provider e ao modelo ativos', async () => {
    let sqlVisto = '';
    let paramsVistos: readonly unknown[] = [];
    const executor: QueryExecutor = {
      query: <T>(sql: string, params: readonly unknown[]): Promise<T[]> => {
        sqlVisto = sql;
        paramsVistos = params;
        return Promise.resolve([] as T[]);
      },
    };

    await createVectorRetriever({
      executor,
      embedder: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        embed: () => Promise.resolve(Array(1536).fill(0.1) as number[]),
        embedBatch: (xs: readonly string[]) => Promise.resolve(xs.map(() => Array(1536).fill(0.1) as number[])),
      },
      workspaceId: 'ws_a',
    }).retrieve({ query: 'q', topK: 5 });

    expect(sqlVisto).toMatch(/e\.provider\s*=/);
    expect(sqlVisto).toMatch(/e\.model\s*=/);
    expect(paramsVistos).toContain('openai');
    expect(paramsVistos).toContain('text-embedding-3-small');
  });
});

const stubEmbedder: EmbeddingProvider = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  embed: () => Promise.resolve(Array(1536).fill(0.1) as number[]),
  embedBatch: (xs: readonly string[]) => Promise.resolve(xs.map(() => Array(1536).fill(0.1) as number[])),
};

describe('o filtro por categoria precisa valer na perna VETORIAL', () => {
  it('parametriza a categoria no WHERE — nunca interpola', async () => {
    // O defeito: só o keyword-retriever tinha `AND s.category = $n`. Na estratégia PADRÃO
    // (`hybrid`) a perna vetorial devolvia skills FORA da categoria pedida, e a fusão as
    // mantinha — o agente pedia uma categoria e recebia outra, **sem erro**. Resultado
    // plausível é o modo mais caro de errar: ninguém investiga o que parece certo.
    //
    // Parametrizado, nunca interpolado: `category` é texto livre vindo do frontmatter de
    // terceiro, e concatená-lo no SQL seria injeção.
    let sqlVisto = '';
    let paramsVistos: unknown[] = [];
    const executor: QueryExecutor = {
      query: (sql, params) => {
        sqlVisto = sql;
        paramsVistos = params as unknown[];
        return Promise.resolve([]);
      },
    };
    const retriever = createVectorRetriever({ executor, embedder: stubEmbedder, workspaceId: 'ws' });

    await retriever.retrieve({ query: 'venda', topK: 5, category: 'Sales' });

    expect(sqlVisto, 'a cláusula existe na perna vetorial').toMatch(/s\.category\s*=/);
    expect(sqlVisto, 'sem interpolação do valor').not.toContain("'Sales'");
    expect(paramsVistos).toContain('Sales');
  });

  it('sem categoria pedida, nenhuma cláusula é adicionada', async () => {
    let sqlVisto = '';
    const executor: QueryExecutor = {
      query: (sql) => {
        sqlVisto = sql;
        return Promise.resolve([]);
      },
    };
    await createVectorRetriever({ executor, embedder: stubEmbedder, workspaceId: 'ws' }).retrieve({
      query: 'venda',
      topK: 5,
    });
    expect(sqlVisto).not.toMatch(/s\.category\s*=/);
  });
});
