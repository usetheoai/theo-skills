import { describe, expect, it } from 'vitest';

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
