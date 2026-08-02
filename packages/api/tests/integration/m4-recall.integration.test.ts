import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createStubEmbedder , DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { type EvalDataset, runRecallEval, seedDataset } from '../../eval/run-recall.js';
import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../eval/dataset.json', import.meta.url)), 'utf8'),
) as EvalDataset;

describeIntegration('M4 eval: Recall@5 + p95 latency (T4.1/T4.2)', () => {
  beforeAll(async () => {
    await truncateAll();
    await seedDataset(getPool(), dataset);
  });
  afterAll(closePool);

  // NÃO é o gate de DoD — renomeado no LT-035 porque o rótulo mentia.
  //
  // Este teste roda com `createStubEmbedder`, que é hash determinístico e NÃO é motor
  // semântico. Chamá-lo de "DoD gate" fazia o CI anunciar que a descoberta por intenção estava
  // aprovada enquanto media apenas léxico + banco: no CI real (`THEOSKILL_SKIP_REAL_EMBED=1`,
  // sem chave) ele passava **com o embedding morto**, que é literalmente o defeito do LT-035.
  //
  // O gate de DoD de verdade vive em `retrieve-latency-real.integration.test.ts`, exerce o
  // embedder real e prova os dois sentidos (vivo passa, morto reprova). Ele está **desligado
  // no CI por opção explícita** — rodá-lo em todo PR gasta crédito do provedor, e isso é
  // decisão de custo do dono. A consequência é real e fica dita em vez de escondida: **hoje
  // nenhum PR mede descoberta por intenção**, e é o que o `theo-skills#106` rastreia.
  //
  // Preferi tirar o rótulo a fazer este teste reprovar sob stub: um teste eternamente vermelho
  // é desligado na primeira semana, e aí some também a cobertura de léxico + banco, que é real.
  // Sem gate é ruim; com gate que mente é pior, porque produz confiança.
  it('léxico + banco: Recall@5 >= 0.85 sob o stub — NÃO mede semântica (ver LT-035)', async () => {
    const retriever = createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: createStubEmbedder() , workspaceId: DEFAULT_WORKSPACE_ID });
    // Torna o escopo ESTRUTURAL em vez de depender do nome: se alguém trocar o embedder por
    // um real aqui, esta linha cai e obriga a decidir conscientemente — em vez de o teste
    // silenciosamente virar (de novo) um gate semântico que ninguém revisou.
    expect(createStubEmbedder().provider, 'este teste é sobre LÉXICO — não troque o embedder').toBe('stub');
    const report = await runRecallEval(retriever, dataset, 'hybrid');
    // 0.85 aqui é o piso de LÉXICO + banco, não o DoD — o rótulo antigo dizia "the real gate
    // (DoD)" e era a mesma afirmação falsa do nome do teste. O dataset é de paráfrases
    // lexicais: 13 de 13 casam por token com a skill esperada, então este número passa mesmo
    // com a perna vetorial desligada, e por isso não pode ser lido como aprovação de busca.
    expect(report.recallAt5, `misses: ${report.misses.join(' | ')}`).toBeGreaterThanOrEqual(0.85);
    expect(report.n).toBe(dataset.cases.length);
  });

  it('HONESTY: vector-only recall is poor under the stub embedder (hybrid recall is FTS-carried)', async () => {
    // The stub embedder is a deterministic hash, NOT semantic — so the vector leg
    // contributes near-random ordering. This test makes that dead-leg VISIBLE: hybrid
    // recall (other test) comes from the FTS lexical component. In production the
    // OpenAI embedder restores semantic vector recall. (Unbreakable Rule 3.)
    const retriever = createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: createStubEmbedder() , workspaceId: DEFAULT_WORKSPACE_ID });
    const vectorOnly = await runRecallEval(retriever, dataset, 'vector');
    expect(vectorOnly.recallAt5).toBeLessThan(0.5); // non-semantic stub → poor vector recall
  });

  it('p95 do caminho SEM rede (banco + fusão) < 200ms — NÃO é a latência da descoberta', async () => {
    // Renomeado no LT-042, porque o nome anterior ("retrieve p95 latency") afirmava o que este
    // teste não mede. Ele roda com `createStubEmbedder` — hash local, zero rede —, então o que
    // ele guarda é o custo de banco + fusão RRF, e nada mais.
    //
    // Por que isso importou: enquanto o nome dizia "retrieve", este gate ficou VERDE durante
    // os 9,3 s que a produção levava no LT-026, porque o trecho caro (a chamada de embedding)
    // nunca esteve no caminho medido. Um teto afirmado sobre um caminho que não se exercita
    // não é gate, é decoração — e a decoração aqui deu cobertura a um defeito real.
    //
    // A latência da descoberta de verdade é medida em `retrieve-latency-real.integration.test.ts`,
    // com embedder real e teto ancorado no LT-029.
    //
    // NOTE: smoke/regression guard at toy corpus size (13 rows) — NOT a production-scale
    // SLO. A larger-corpus latency probe is a follow-up before any public SLA claim.
    const retriever = createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: createStubEmbedder() , workspaceId: DEFAULT_WORKSPACE_ID });
    await runRecallEval(retriever, dataset); // warm
    const report = await runRecallEval(retriever, dataset);
    expect(report.p95Ms).toBeLessThan(200);
  });
});
