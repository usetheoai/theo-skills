import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createStubEmbedder } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { type EvalDataset, runRecallEval, seedDataset } from '../../eval/run-recall.js';
import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M11 risco #1 — "Busca vetorial com filtro de tenant […] **Ameaça direta às metas de M4
 * (Recall@5 ≥ 0.85, p95 < 200ms)**. Mitigação: **medir antes de prometer**."
 *
 * Este arquivo é essa medição. Ele não é um gate novo: reusa exatamente o gate do M4 e o
 * aplica sob a condição que o M11 criou — o índice populado por VÁRIOS tenants, com o
 * retrieve filtrando para um só. Se o filtro degradasse o recall ou o planner abandonasse
 * o índice, é aqui que apareceria, e o número medido vai para o ADR.
 */

const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../eval/dataset.json', import.meta.url)), 'utf8'),
) as EvalDataset;

/** O tenant sob medição. */
const WS_TARGET = 'ws_measured';
/** Vizinhos que povoam o MESMO índice global — sem eles o filtro não teria o que excluir. */
const WS_NOISE = ['ws_noise_1', 'ws_noise_2', 'ws_noise_3', 'ws_noise_4'];

describeIntegration('M11 — Recall@5 e p95 SOB filtro de tenant (risco #1)', () => {
  beforeAll(async () => {
    await truncateAll();
    // O mesmo acervo em 5 workspaces: o índice HNSW passa a conter 5× as linhas, e só
    // 1/5 é elegível para o tenant medido. É a forma barata de reproduzir a condição de
    // produção (índice global, resultado por tenant) num corpus de teste.
    await seedDataset(getPool(), dataset, WS_TARGET);
    for (const ws of WS_NOISE) await seedDataset(getPool(), dataset, ws);
  }, 60_000);
  afterAll(closePool);

  const retriever = () =>
    createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId: WS_TARGET,
    });

  it('mantém Recall@5 >= 0.85 com o índice compartilhado por 5 tenants', async () => {
    const report = await runRecallEval(retriever(), dataset, 'hybrid');
    // Mesmo gate do M4 — o filtro de tenant não pode custar recall.
    expect(report.recallAt5, `misses: ${report.misses.join(' | ')}`).toBeGreaterThanOrEqual(0.85);
    expect(report.n).toBe(dataset.cases.length);
  });

  it('mantém p95 < 200ms com o índice compartilhado por 5 tenants', async () => {
    // Guarda de regressão em corpus de brinquedo (13 skills × 5 tenants) — NÃO é um SLO de
    // produção, e dizer o contrário seria a desonestidade que o gate original já evita.
    // O que este número prova é o negativo que importa: o filtro não fez o planner
    // abandonar o índice a ponto de estourar a ordem de grandeza.
    await runRecallEval(retriever(), dataset); // warm
    const report = await runRecallEval(retriever(), dataset);
    expect(report.p95Ms).toBeLessThan(200);
  });

  it('MEDIÇÃO: publica os números que o ADR do risco #1 registra', async () => {
    const withFilter = await runRecallEval(retriever(), dataset, 'hybrid');
    // Este teste não reprova por número — ele EXISTE para que o valor apareça no log do CI
    // e possa ser transcrito para o ADR. Falhar aqui só acontece se a medição não puder
    // ser feita, que é uma condição diferente de "o número ficou ruim".
    // eslint-disable-next-line no-console
    console.log(
      `[M11-MEDICAO] tenants=${String(WS_NOISE.length + 1)} recall@5=${withFilter.recallAt5.toFixed(3)} ` +
        `p95=${withFilter.p95Ms.toFixed(1)}ms n=${String(withFilter.n)}`,
    );
    expect(withFilter.n).toBeGreaterThan(0);
  });
});
