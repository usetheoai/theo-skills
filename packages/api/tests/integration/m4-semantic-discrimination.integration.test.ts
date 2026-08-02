import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createStubEmbedder, DEFAULT_WORKSPACE_ID, type EmbeddingProvider } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { type EvalCase, type EvalDataset, runRecallEval, seedDataset } from '../../eval/run-recall.js';
import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * O gate de recall do M4 mede LÉXICO, não semântica — e isto prova.
 *
 * Achado LT-035, medido em 2026-08-01: as 13 consultas de `cases` compartilham token com o
 * texto indexado da skill esperada — 13 de 13. Logo `Recall@5 >= 0.85` continua verde com o
 * embedding morto, que é o estado de produção hoje (provedor sem crédito). O arquivo vizinho
 * `m4-recall.integration.test.ts` já era honesto sobre a PERNA vetorial estar morta sob o
 * stub; o que faltava dizer é que o DATASET não tem poder de discriminação — nem com embedding
 * real restaurado ele acusaria uma quebra futura.
 *
 * A pergunta que este arquivo responde: **existe uma implementação errada que passaria no
 * gate de 0.85?** Existe — uma que não faça busca semântica alguma. O cenário-âncora do
 * produto exige casar um SINÔNIMO ausente do título, e a cobertura desse requisito era zero.
 */
const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../eval/dataset.json', import.meta.url)), 'utf8'),
) as EvalDataset;

const semanticCases: EvalCase[] = dataset.semantic_cases ?? [];

/** Tokens comparáveis — a mesma normalização grosseira que o FTS aplicaria. */
function tokens(texto: string): Set<string> {
  return new Set((texto.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2));
}
/** Palavras funcionais: casá-las não é sinal de recuperação, é ruído. */
const VAZIAS = tokens('the and for into from with that this out its give one');

describeIntegration('M4 discriminação semântica (LT-035)', () => {
  beforeAll(async () => {
    await truncateAll();
    await seedDataset(getPool(), dataset);
  });
  afterAll(closePool);

  it('as consultas semânticas têm overlap léxico ZERO — é o que as torna capazes de discriminar', () => {
    // Garantia ESTRUTURAL, sem embedder e sem rede: se um termo da consulta aparecesse no
    // texto indexado, a perna lexical a resolveria sozinha e o caso deixaria de provar
    // qualquer coisa. É exatamente assim que os 13 casos originais perderam o poder de
    // discriminação — um por vez, cada um plausível.
    expect(semanticCases.length).toBeGreaterThanOrEqual(5);
    const indexado = new Map(
      dataset.skills.map((s) => [s.skill_id, tokens(`${s.name} ${s.description} ${s.body}`)]),
    );
    const vazando = semanticCases
      .map((c) => {
        const alvo = indexado.get(c.expected);
        const ov = [...tokens(c.query)].filter((t) => !VAZIAS.has(t) && alvo?.has(t) === true);
        return ov.length > 0 ? `"${c.query}" → ${c.expected} casa [${ov.join(', ')}]` : '';
      })
      .filter((s) => s !== '');
    expect(vazando, `consultas resolvíveis por substring:\n${vazando.join('\n')}`).toEqual([]);
  });

  it('PROVA: o gate de 0.85 é carregado pelo LÉXICO — keyword sozinho já o satisfaz', async () => {
    // Este é o achado convertido em asserção. Enquanto `keyword` sozinho alcançar o mesmo
    // patamar do gate, o gate NÃO é evidência de descoberta por intenção. Quando alguém
    // adicionar casos que só a semântica resolve, este teste fica vermelho — e o vermelho
    // aqui é a notícia boa: significa que o gate passou a medir algo.
    const retriever = createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    const soLexico = await runRecallEval(retriever, dataset, 'keyword');
    expect(
      soLexico.recallAt5,
      'keyword-only caiu abaixo de 0.85: o gate deixou de ser puramente lexical — mova a ' +
        'afirmação de "o gate mede léxico" para o novo patamar medido, não relaxe este número.',
    ).toBeGreaterThanOrEqual(0.85);
  });

  it('PROVA: nenhuma delas é alcançável por léxico — keyword sozinho não recupera nada', async () => {
    const retriever = createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    const soLexico = await runRecallEval(retriever, { ...dataset, cases: semanticCases }, 'keyword');
    // Complementa a asserção estrutural acima com o comportamento REAL do FTS (stemming,
    // sinônimos do dicionário) — o overlap zero é sobre tokens crus; isto é sobre o motor.
    expect(soLexico.recallAt5).toBeLessThanOrEqual(0.2);
  });

  it('CONTROLE NEGATIVO: com o embedding quebrado de propósito, o gate de 0.85 NÃO reprova', async () => {
    // O teste que fecha a prova. Sem ele, trocar o conjunto de casos entrega a mesma promessa
    // de antes com roupa nova: um gate que diz "sim" mas do qual ninguém verificou se
    // consegue dizer "não".
    //
    // Quebra deliberada: vetor CONSTANTE — todo par de vizinhos fica equidistante e a perna
    // vetorial perde todo o significado.
    //
    // Vetor constante, NÃO um embedder que explode: a distinção importa e eu a errei na
    // primeira tentativa. Um objeto com a assinatura errada fazia a perna vetorial LANÇAR, e
    // aí a medição era "perna caiu" — que o `.catch` do híbrido já trata — em vez de
    // "embedding chegou, é válido, e não quer dizer nada". O segundo é o cenário real de uma
    // troca de provider ou de uma conta sem crédito, e é o que precisa ser medido.
    const constante: EmbeddingProvider = {
      provider: 'stub',
      model: 'constante-sem-significado',
      embed: () => Promise.resolve(new Array<number>(1536).fill(0.001)),
      embedBatch: (texts: string[]) =>
        Promise.resolve(texts.map(() => new Array<number>(1536).fill(0.001))),
    };
    const comEmbedding = createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    const semEmbedding = createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: constante,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    const vivo = await runRecallEval(comEmbedding, dataset, 'hybrid');
    const morto = await runRecallEval(semEmbedding, dataset, 'hybrid');

    // TRIPWIRE, e a asserção é do DEFEITO — de propósito. Hoje os dois números são iguais:
    // o gate é cego ao embedding, e chamá-lo de evidência de descoberta por intenção é
    // afirmar o que ele não mede. Quando o embedder real voltar (crédito é decisão do dono) e
    // os `semantic_cases` forem dobrados no gate, ESTA linha fica vermelha — e o vermelho é a
    // notícia: o portão passou a saber dizer não. Trocar então por `morto < vivo`.
    expect(
      morto.recallAt5,
      `gate com embedding vivo=${String(vivo.recallAt5)} vs morto=${String(morto.recallAt5)} — ` +
        'se divergiram, o gate deixou de ser cego: inverta este tripwire para exigir a queda.',
    ).toBe(vivo.recallAt5);
    expect(vivo.recallAt5).toBeGreaterThanOrEqual(0.85);

    // E o contraste que fecha o argumento: sob os MESMOS dois embedders, o conjunto novo
    // RESPONDE. Medido — gate: 1.00 → 1.00 (Δ 0); semânticas: 0.40 → 0.00 (Δ 0.40). Não é
    // opinião sobre qual conjunto é melhor: um move quando o embedding morre, o outro não se
    // mexe. Esta asserção é um portão que já sabe reprovar HOJE, sem depender de crédito no
    // provedor — se alguém quebrar o embedding, ela fica vermelha.
    const semanticasVivo = await runRecallEval(comEmbedding, { ...dataset, cases: semanticCases }, 'hybrid');
    const semanticasMorto = await runRecallEval(semEmbedding, { ...dataset, cases: semanticCases }, 'hybrid');
    expect(
      semanticasMorto.recallAt5,
      'o conjunto semântico parou de responder ao embedding — se ele não cai quando o ' +
        'embedding morre, perdeu o poder de discriminação e virou o gate que ele veio substituir.',
    ).toBeLessThan(semanticasVivo.recallAt5);
  });

  it('HONESTIDADE: sob o stub embedder a busca semântica também não as resolve', async () => {
    // Não é falha do produto: o stub é um hash determinístico, não um modelo. O valor de
    // afirmar isto é impedir que alguém leia o conjunto semântico como já coberto. A
    // recuperação delas só é demonstrável com embedder real — hoje bloqueada por crédito no
    // provedor (SURFACE-theo-skills.md § 6, item 8), que é decisão do dono, não deste repo.
    const retriever = createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    const hibrido = await runRecallEval(retriever, { ...dataset, cases: semanticCases }, 'hybrid');
    expect(hibrido.recallAt5).toBeLessThan(0.85);
  });
});
