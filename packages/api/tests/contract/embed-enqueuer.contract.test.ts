import { describe, expect, it, vi } from 'vitest';

import { createEmbedEnqueuer } from '../../src/server/embed/embed-worker.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { EMBED_SKILL_SINGLETON_SECONDS, JOB_NAMES } from '../../src/server/queue/queue.js';
import { type EmbeddingsStore } from '../../src/server/store/embeddings-store.js';

const source = (skillId: string, revisionId: string) => ({ skillId, revisionId, name: skillId, description: '', skillMd: '' });

function deps(sourceForSkill: EmbeddingsStore['getEmbedSourceBySkill']) {
  const send = vi.fn(() => Promise.resolve('job-id'));
  const store = { getEmbedSourceBySkill: sourceForSkill } as unknown as EmbeddingsStore;
  return { queue: { send } as never, send, store };
}

describe('createEmbedEnqueuer (onTerminal → embed enqueue)', () => {
  it('enqueues embed_skill on ACTIVE skill.created with singletonKey=revisionId', async () => {
    const { queue, send, store } = deps(() => Promise.resolve(source('s1', 'rev_1')));
    const onTerminal = createEmbedEnqueuer({ queue, embeddingsStoreFor: () => store, logger: createNoopLogger() });
    await onTerminal({ operationId: 'op1', skillId: 's1', traceId: 'tr-test', eventType: 'skill.created', state: 'ACTIVE', workspaceId: 'default' });
    expect(send).toHaveBeenCalledOnce();
    const [name, data, options] = send.mock.calls[0] as unknown as [string, { skill_id: string; revision_id: string }, { singletonKey: string; singletonSeconds: number }];
    expect(name).toBe(JOB_NAMES.EMBED_SKILL);
    // O inquilino viaja NO JOB: o worker roda fora da requisição e não tem como
    // redescobri-lo. Sem ele, escrever o embedding exigia adivinhar o workspace — e o
    // palpite disponível era o legado, silenciosamente errado para todo cliente real.
    expect(data).toEqual({ workspaceId: 'default', skill_id: 's1', revision_id: 'rev_1' });
    expect(options.singletonKey).toBe('rev_1'); // keyed per revision — update never dedups against prior
    expect(options.singletonSeconds).toBe(EMBED_SKILL_SINGLETON_SECONDS);
  });

  it('enqueues on ACTIVE skill.updated', async () => {
    const { queue, send, store } = deps(() => Promise.resolve(source('s2', 'rev_2')));
    const onTerminal = createEmbedEnqueuer({ queue, embeddingsStoreFor: () => store, logger: createNoopLogger() });
    await onTerminal({ operationId: 'op1', skillId: 's2', traceId: 'tr-test', eventType: 'skill.updated', state: 'ACTIVE', workspaceId: 'default' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('does NOT enqueue on skill.deleted', async () => {
    const { queue, send, store } = deps(() => Promise.resolve(source('s3', 'rev_3')));
    const onTerminal = createEmbedEnqueuer({ queue, embeddingsStoreFor: () => store, logger: createNoopLogger() });
    await onTerminal({ operationId: 'op1', skillId: 's3', traceId: 'tr-test', eventType: 'skill.deleted', state: 'ACTIVE', workspaceId: 'default' });
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT enqueue on a FAILED operation', async () => {
    const { queue, send, store } = deps(() => Promise.resolve(source('s4', 'rev_4')));
    const onTerminal = createEmbedEnqueuer({ queue, embeddingsStoreFor: () => store, logger: createNoopLogger() });
    await onTerminal({ operationId: 'op1', skillId: 's4', traceId: 'tr-test', eventType: 'skill.created', state: 'FAILED', workspaceId: 'default' });
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT enqueue when the skill has no current revision', async () => {
    const { queue, send, store } = deps(() => Promise.resolve(undefined));
    const onTerminal = createEmbedEnqueuer({ queue, embeddingsStoreFor: () => store, logger: createNoopLogger() });
    await onTerminal({ operationId: 'op1', skillId: 'gone', traceId: 'tr-test', eventType: 'skill.created', state: 'ACTIVE', workspaceId: 'default' });
    expect(send).not.toHaveBeenCalled();
  });
});
