import { describe, expect, it } from 'vitest';

import { createHybridRetriever, rrfFuse, RRF_K } from './hybrid-retriever.js';
import { type RetrievedSkill, type SkillRetriever } from './types.js';

const sk = (id: string): RetrievedSkill => ({ skill_id: id, score: 0, name: id, description: '' });
const listRetriever = (list: RetrievedSkill[]): SkillRetriever => ({ retrieve: () => Promise.resolve(list) });
const delayed = (list: RetrievedSkill[], ms: number): SkillRetriever => ({
  retrieve: () => new Promise((r) => setTimeout(() => r(list), ms)),
});

describe('rrfFuse (Reciprocal Rank Fusion, k=60)', () => {
  it('scores a single-list skill as 1/(k+rank)', () => {
    const out = rrfFuse([sk('a'), sk('b')], [], 10);
    expect(out[0]).toMatchObject({ skill_id: 'a', score: 1 / (RRF_K + 0) });
    expect(out[1]).toMatchObject({ skill_id: 'b', score: 1 / (RRF_K + 1) });
  });

  it('sums both terms for a skill present in both lists', () => {
    // 'x' is rank 0 in vector and rank 1 in keyword → 1/60 + 1/61
    const out = rrfFuse([sk('x'), sk('y')], [sk('y'), sk('x')], 10);
    const x = out.find((r) => r.skill_id === 'x')!;
    expect(x.score).toBeCloseTo(1 / 60 + 1 / 61, 10);
    // 'x' (1/60+1/61) ranks above 'y' (1/61+1/60)? they're equal → tie-break by id
    expect(out.map((r) => r.skill_id)).toEqual(['x', 'y']);
  });

  it('orders by fused score desc and truncates to topK', () => {
    const out = rrfFuse([sk('a'), sk('b'), sk('c')], [sk('b')], 2);
    expect(out.map((r) => r.skill_id)).toEqual(['b', 'a']); // b is in both → highest
    expect(out).toHaveLength(2);
  });

  it('returns [] for two empty lists', () => {
    expect(rrfFuse([], [], 5)).toEqual([]);
  });
});

describe('createHybridRetriever', () => {
  it('fuses vector + keyword results', async () => {
    const r = createHybridRetriever({ vector: listRetriever([sk('a')]), keyword: listRetriever([sk('b')]) });
    const out = await r.retrieve({ query: 'q', topK: 10 });
    expect(out.map((x) => x.skill_id).sort()).toEqual(['a', 'b']);
  });

  it('degrades to vector-only with correct RRF scores when keyword fails', async () => {
    const failing: SkillRetriever = { retrieve: () => Promise.reject(new Error('no FTS')) };
    const r = createHybridRetriever({ vector: listRetriever([sk('a'), sk('b')]), keyword: failing });
    const out = await r.retrieve({ query: 'q', topK: 10 });
    expect(out[0]).toMatchObject({ skill_id: 'a', score: 1 / (RRF_K + 0) }); // exact score, not zeroed
    expect(out[1]).toMatchObject({ skill_id: 'b', score: 1 / (RRF_K + 1) });
  });

  it('degrades to keyword-only when the vector side fails (embedder down)', async () => {
    const failing: SkillRetriever = { retrieve: () => Promise.reject(new Error('embedder down')) };
    const r = createHybridRetriever({ vector: failing, keyword: listRetriever([sk('k')]) });
    const out = await r.retrieve({ query: 'q', topK: 10 });
    expect(out.map((x) => x.skill_id)).toEqual(['k']); // keyword-only, no throw
  });

  it('Concurrent test: fusion is order-independent regardless of which retriever resolves first', async () => {
    const slowVectorFastKeyword = createHybridRetriever({ vector: delayed([sk('a'), sk('b')], 20), keyword: delayed([sk('b')], 1) });
    const fastVectorSlowKeyword = createHybridRetriever({ vector: delayed([sk('a'), sk('b')], 1), keyword: delayed([sk('b')], 20) });
    const out1 = await slowVectorFastKeyword.retrieve({ query: 'q', topK: 10 });
    const out2 = await fastVectorSlowKeyword.retrieve({ query: 'q', topK: 10 });
    expect(out1).toEqual(out2); // deterministic — 'b' (both lists) first regardless of timing
    expect(out1[0]?.skill_id).toBe('b');
  });
});

describe('a fusão não pode PERDER campo que só um lado projetou', () => {
  it('mescla os campos das duas listas em vez de manter só a primeira linha vista', () => {
    // O defeito: `execution` e `category` vinham só do keyword; o vetor era acumulado
    // primeiro, e a linha dele — sem os campos — vencia. Para toda skill presente nas DUAS
    // listas (o caso comum) os campos sumiam do resultado, e o cliente trata ausente como
    // permitido. Nada erra: a resposta é plausível e incompleta.
    const doVetor = [{ skill_id: 's1', name: 'a', description: 'd', score: 0.9, origin: 'own' as const }];
    const doKeyword = [
      { skill_id: 's1', name: 'a', description: 'd', score: 0.5, origin: 'own' as const, execution: 'local' as const, category: 'Ops' },
    ];

    const fundido = rrfFuse(doVetor, doKeyword, 10);

    expect(fundido[0]?.execution, 'o campo sobrevive à fusão').toBe('local');
    expect(fundido[0]?.category).toBe('Ops');
  });
});
