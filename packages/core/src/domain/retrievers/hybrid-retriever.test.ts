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

describe('a degradação da busca precisa ser VISÍVEL', () => {
  it('quando a perna vetorial falha, o híbrido AVISA — não serve resultado pior com cara de bom', async () => {
    // Medido em produção 2026-08-01: a conta do provedor de embedding ficou sem crédito, a
    // perna vetorial passou a falhar, e o `.catch(() => [])` a transformava em lista vazia.
    // A busca respondia 200 com resultado LEXICAL, e a descoberta semântica — a promessa
    // central do produto — estava morta sem que nada acusasse. `/v1/health` dizia `ok`.
    //
    // Resiliência sem observabilidade é o defeito, não a solução: quem resolve não fica
    // sabendo, e quem consome não sabe que recebeu menos.
    const avisos: string[] = [];
    const explode: SkillRetriever = { retrieve: () => Promise.reject(new Error('sem credito')) };
    const lista: SkillRetriever = { retrieve: () => Promise.resolve([sk('a')]) };

    const r = createHybridRetriever({
      vector: explode,
      keyword: lista,
      onDegraded: (perna, err) => avisos.push(`${perna}: ${(err as Error).message}`),
    });
    const out = await r.retrieve({ query: 'x', topK: 5 });

    expect(out.map((s) => s.skill_id), 'a perna viva ainda responde').toEqual(['a']);
    expect(avisos, 'e a falha foi ANUNCIADA, com a causa').toEqual(['vector: sem credito']);
  });

  it('sem falha alguma, ninguém é avisado', async () => {
    const avisos: string[] = [];
    const r = createHybridRetriever({
      vector: { retrieve: () => Promise.resolve([sk('a')]) },
      keyword: { retrieve: () => Promise.resolve([sk('b')]) },
      onDegraded: (p) => avisos.push(p),
    });
    await r.retrieve({ query: 'x', topK: 5 });
    expect(avisos).toEqual([]);
  });
});

describe('a busca tem TETO de tempo — uma perna lenta não sequestra a resposta', () => {
  it('perna que demora além do teto é abandonada, e a viva responde', async () => {
    // Medido em produção 2026-08-01: com a conta do provedor sem crédito, a perna vetorial
    // levava 9,4 s e a busca inteira ia junto. Detectar o formato do erro do fornecedor é
    // frágil — ele mudou de `code` entre versões e a mensagem é texto livre. O teto não
    // depende de adivinhar nada: seja qual for a causa, a descoberta não pode gastar o
    // orçamento de latência do agente esperando uma metade que não responde.
    const lenta: SkillRetriever = { retrieve: () => new Promise((r) => setTimeout(() => r([sk('lenta')]), 5_000)) };
    const rapida: SkillRetriever = { retrieve: () => Promise.resolve([sk('rapida')]) };
    const avisos: string[] = [];

    const t0 = Date.now();
    const out = await createHybridRetriever({
      vector: lenta,
      keyword: rapida,
      timeoutMs: 100,
      onDegraded: (perna) => avisos.push(perna),
    }).retrieve({ query: 'x', topK: 5 });
    const gasto = Date.now() - t0;

    expect(out.map((s) => s.skill_id), 'a perna viva responde').toEqual(['rapida']);
    expect(gasto, 'não esperou a lenta').toBeLessThan(1_000);
    expect(avisos, 'e o abandono foi anunciado').toEqual(['vector']);
  });

  it('sem teto configurado, espera — quem não pediu limite não ganha um por surpresa', async () => {
    const meio: SkillRetriever = { retrieve: () => new Promise((r) => setTimeout(() => r([sk('a')]), 60)) };
    const out = await createHybridRetriever({
      vector: meio,
      keyword: { retrieve: () => Promise.resolve([]) },
    }).retrieve({ query: 'x', topK: 5 });
    expect(out.map((s) => s.skill_id)).toEqual(['a']);
  });
});

describe('o race não pode ser desfeito por um await posterior', () => {
  it('a resposta sai no teto mesmo que a perna lenta NUNCA termine', async () => {
    // Hipótese do coordenador, testada: um `Promise.race` não CANCELA a perna lenta — só
    // deixa de esperar por ela. Se qualquer passo depois do race (a fusão, um `Promise.all`
    // das duas, um `finally`) voltar a esperá-la, os 9 s reaparecem e o teto vira decoração.
    //
    // Aqui a perna lenta nunca resolve. Se a resposta sair, o race não foi desfeito.
    const nuncaResolve: SkillRetriever = { retrieve: () => new Promise<RetrievedSkill[]>(() => undefined) };
    const rapida: SkillRetriever = { retrieve: () => Promise.resolve([sk('viva')]) };

    const t0 = Date.now();
    const out = await createHybridRetriever({ vector: nuncaResolve, keyword: rapida, timeoutMs: 80 }).retrieve({
      query: 'x',
      topK: 5,
    });
    const gasto = Date.now() - t0;

    expect(out.map((s) => s.skill_id)).toEqual(['viva']);
    expect(gasto, 'saiu no teto, não esperou o infinito').toBeLessThan(800);
  });
});

describe('atribuição por perna (M31 — a busca diz de ONDE veio cada resultado)', () => {
  it('declara as duas pernas quando a skill está nas duas listas', () => {
    const [a] = rrfFuse([sk('a')], [sk('a')], 10);

    expect(a?.matched).toEqual([
      { leg: 'vector', rank: 1 },
      { leg: 'keyword', rank: 1 },
    ]);
  });

  // O TESTE QUE DISCRIMINA (R6 do blueprint, marcado NÃO-OPCIONAL no plano).
  //
  // Sem ele a atribuição pode MENTIR com aparência de dado: um acumulador alimentado errado
  // emite `keyword` para uma skill que só a busca vetorial trouxe, e nada acusa — o score
  // fundido continua correto, os outros testes continuam verdes.
  //
  // É a mesma classe do LT-035, onde o portão de qualidade da busca passava com metade do
  // motor morto porque assertava sobre o agregado. Um teste que não falha quando deveria não
  // é gate; é decoração com custo de manutenção.
  it('NÃO alega uma perna que não contribuiu', () => {
    const [a] = rrfFuse([sk('a')], [], 10);

    expect(a?.matched).toEqual([{ leg: 'vector', rank: 1 }]);
    expect(a?.matched?.some((m) => m.leg === 'keyword')).toBe(false);
  });

  it('expõe rank 1-based, embora o laço interno seja 0-based', () => {
    // O interno PRECISA ser 0-based: a fórmula é 1/(RRF_K + rank), e o primeiro colocado
    // tem de valer 1/RRF_K. O contrato externo é para humano — "1º" e não "0º".
    const [, b] = rrfFuse([sk('a'), sk('b')], [], 10);

    expect(b?.matched).toEqual([{ leg: 'vector', rank: 2 }]);
    expect(b?.score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });
});
