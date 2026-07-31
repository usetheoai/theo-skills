import { type SkillRetriever } from '@usetheo/skills';
import { describe, expect, it } from 'vitest';

import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';

const tagging = (tag: string): SkillRetriever => ({
  retrieve: () => Promise.resolve([{ skill_id: tag, score: 1, name: tag, description: '' }]),
});

const noExecutor = { query: () => Promise.resolve([]) };
const noEmbedder = { provider: 'stub' as const, model: 'stub', embed: () => Promise.resolve([]), embedBatch: () => Promise.resolve([]) };

describe('createDispatchingRetriever', () => {
  it('routes to the retriever matching params.strategy', async () => {
    const d = createDispatchingRetriever({
      executor: noExecutor,
      embedder: noEmbedder,
      workspaceId: 'ws_contract',
      overrides: { vector: tagging('V'), keyword: tagging('K'), hybrid: tagging('H') },
    });
    expect((await d.retrieve({ query: 'q', topK: 1, strategy: 'vector' }))[0]?.skill_id).toBe('V');
    expect((await d.retrieve({ query: 'q', topK: 1, strategy: 'keyword' }))[0]?.skill_id).toBe('K');
    expect((await d.retrieve({ query: 'q', topK: 1, strategy: 'hybrid' }))[0]?.skill_id).toBe('H');
  });
});
