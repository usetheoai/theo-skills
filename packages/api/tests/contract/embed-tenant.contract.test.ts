import type PgBoss from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { createEmbedEnqueuer, createEmbedSkillHandler } from '../../src/server/embed/embed-worker.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { type EmbeddingsStore } from '../../src/server/store/embeddings-store.js';

/**
 * O EMBEDDING ATRAVESSA O INQUILINO — enfileirar e processar.
 *
 * O ponto de montagem construía UM store fixo em `DEFAULT_WORKSPACE_ID` e o entregava tanto
 * ao enfileirador quanto ao worker. Para uma skill de qualquer outro cliente,
 * `getEmbedSourceBySkill` não achava nada e o enfileirador **retornava em silêncio**: sem
 * job, sem log, sem erro.
 *
 * Consequência medida em 2026-07-31 no serviço no ar: **1 embedding para 8 skills**, o único
 * no inquilino legado. A descoberta semântica — a promessa central do produto — nunca
 * funcionou para cliente nenhum, e nada nunca falhou.
 *
 * É a mesma classe do defeito das operações: o inquilino existe no contrato e não atravessa
 * a fronteira. A diferença é que aqui o modo de falha é ainda pior — lá o publisher via um
 * `404`; aqui ninguém vê nada.
 */

const fonte = { revisionId: 'rev_1', skillId: 'sk_1', name: 'n', description: 'd', body: 'b' };

function storePara(esperado: string): { store: EmbeddingsStore; chamado: () => boolean } {
  let bateu = false;
  const store = {
    getEmbedSourceBySkill: () => {
      bateu = true;
      return Promise.resolve(fonte);
    },
    getEmbedSourceByRevision: () => {
      bateu = true;
      return Promise.resolve(fonte);
    },
    upsert: () => Promise.resolve(),
  } as unknown as EmbeddingsStore;
  void esperado;
  return { store, chamado: () => bateu };
}

describe('embedding por inquilino', () => {
  it('enfileira para uma skill de workspace NÃO-default, com o inquilino no job', async () => {
    const send = vi.fn(() => Promise.resolve('job_1'));
    const queue = { send } as unknown as PgBoss;
    const vistos: string[] = [];

    const enqueue = createEmbedEnqueuer({
      queue,
      embeddingsStoreFor: (ws: string) => {
        vistos.push(ws);
        return storePara(ws).store;
      },
      logger: createNoopLogger(),
    });

    await enqueue({
      operationId: 'op_1',
      skillId: 'sk_1',
      traceId: 't',
      eventType: 'skill.created',
      state: 'ACTIVE',
      workspaceId: 'ws_cliente',
    });

    // O store consultado é o DO CLIENTE — não o legado.
    expect(vistos).toEqual(['ws_cliente']);
    expect(send).toHaveBeenCalledTimes(1);
    // E o job carrega o inquilino, senão o worker teria de adivinhar onde escrever.
    expect((send.mock.calls[0] as unknown as [string, { workspaceId?: string }])[1].workspaceId).toBe('ws_cliente');
  });

  it('o worker escreve no inquilino que o job declara', async () => {
    const vistos: string[] = [];
    const handler = createEmbedSkillHandler({
      embeddingsStoreFor: (ws: string) => {
        vistos.push(ws);
        return storePara(ws).store;
      },
      embedder: {
        provider: 'stub',
        model: 'stub',
        embed: () => Promise.resolve(Array(1536).fill(0.1) as number[]),
        embedBatch: (xs: readonly string[]) => Promise.resolve(xs.map(() => Array(1536).fill(0.1) as number[])),
      },
      logger: createNoopLogger(),
    });

    await handler({ workspaceId: 'ws_cliente', skill_id: 'sk_1', revision_id: 'rev_1' });
    expect(vistos).toEqual(['ws_cliente']);
  });
});
