import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createStubEmbedder } from '@usetheo/skills';
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

  it('hybrid retrieve meets Recall@5 >= 0.85 on the internal eval set (DoD gate)', async () => {
    const retriever = createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: createStubEmbedder() });
    const report = await runRecallEval(retriever, dataset, 'hybrid');
    // 0.85 is the real gate (DoD). Misses are surfaced in the message for debuggability,
    // but a single miss does NOT fail the suite — the dataset is curated lexical paraphrases.
    expect(report.recallAt5, `misses: ${report.misses.join(' | ')}`).toBeGreaterThanOrEqual(0.85);
    expect(report.n).toBe(dataset.cases.length);
  });

  it('HONESTY: vector-only recall is poor under the stub embedder (hybrid recall is FTS-carried)', async () => {
    // The stub embedder is a deterministic hash, NOT semantic — so the vector leg
    // contributes near-random ordering. This test makes that dead-leg VISIBLE: hybrid
    // recall (other test) comes from the FTS lexical component. In production the
    // OpenAI embedder restores semantic vector recall. (Unbreakable Rule 3.)
    const retriever = createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: createStubEmbedder() });
    const vectorOnly = await runRecallEval(retriever, dataset, 'vector');
    expect(vectorOnly.recallAt5).toBeLessThan(0.5); // non-semantic stub → poor vector recall
  });

  it('retrieve p95 latency < 200ms over the eval queries', async () => {
    // NOTE: smoke/regression guard at toy corpus size (13 rows) — NOT a production-scale
    // SLO. A larger-corpus latency probe is a follow-up before any public SLA claim.
    const retriever = createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: createStubEmbedder() });
    await runRecallEval(retriever, dataset); // warm
    const report = await runRecallEval(retriever, dataset);
    expect(report.p95Ms).toBeLessThan(200);
  });
});
