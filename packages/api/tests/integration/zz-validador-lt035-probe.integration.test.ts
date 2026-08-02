/**
 * SONDA TEMPORARIA DO VALIDADOR (LT-035) — apagar apos a medicao.
 *
 * Pergunta unica: com o embedder REAL (o credito voltou — provado no LT-042), o gate
 * consegue REPROVAR quando o embedding morre? Mede quatro numeros no mesmo banco:
 *
 *   dataset completo (o gate de 0.85):   real  vs  morto
 *   semantic_cases  (os que o lexico     real  vs  morto
 *                    nao resolve)
 *
 * Se real > morto nos semantic_cases, o discriminador existe HOJE e o adiamento
 * ("bloqueado por ambiente") deixou de se justificar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createId } from '@paralleldrive/cuid2';
import { createOpenAIEmbedder, DEFAULT_WORKSPACE_ID, type EmbeddingProvider } from '@usetheo/skills';
import { afterAll, beforeAll, it } from 'vitest';

import { type EvalCase, type EvalDataset, runRecallEval } from '../../eval/run-recall.js';
import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../eval/dataset.json', import.meta.url)), 'utf8'),
) as EvalDataset;
const semanticCases: EvalCase[] = dataset.semantic_cases ?? [];

const real: EmbeddingProvider = createOpenAIEmbedder({});
const morto: EmbeddingProvider = {
  provider: 'stub',
  model: 'constante-sem-significado',
  embed: () => Promise.resolve(new Array<number>(1536).fill(0.001)),
  embedBatch: (t: string[]) => Promise.resolve(t.map(() => new Array<number>(1536).fill(0.001))),
};

describeIntegration('SONDA validador LT-035 — o gate reprova com embedding morto?', () => {
  beforeAll(async () => {
    await truncateAll();
    const pool = getPool();
    for (const s of dataset.skills) {
      const revisionId = `rev_${createId()}`;
      const searchText = `${s.name} ${s.description} ${s.body}`;
      await pool.query(
        `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text) VALUES ($1,$2,$3,$4,$5,$6)`,
        [DEFAULT_WORKSPACE_ID, s.skill_id, s.name, s.description, revisionId, searchText],
      );
      await pool.query(
        `INSERT INTO skill_revisions (revision_id, workspace_id, skill_id, payload, content_hash, frontmatter, skill_md) VALUES ($1,$2,$3,'\\x00',$4,'{}'::jsonb,$5)`,
        [revisionId, DEFAULT_WORKSPACE_ID, s.skill_id, `h_${revisionId}`, s.body],
      );
      // Indexado com o embedder REAL — e este o ponto da sonda.
      const v = await real.embed(searchText);
      await pool.query(
        `INSERT INTO embeddings (id, workspace_id, revision_id, skill_id, provider, model, dimensions, vector) VALUES ($1,$2,$3,$4,$5,$6,1536,$7::vector)`,
        [`emb_${createId()}`, DEFAULT_WORKSPACE_ID, revisionId, s.skill_id, real.provider, real.model, `[${v.join(',')}]`],
      );
    }
  }, 300_000);
  afterAll(closePool);

  it('mede os quatro numeros', async () => {
    const mk = (e: EmbeddingProvider) =>
      createDispatchingRetriever({
        executor: createPgExecutor(getPool()),
        embedder: e,
        workspaceId: DEFAULT_WORKSPACE_ID,
      });
    const rReal = mk(real);
    const rMorto = mk(morto);

    const fullReal = await runRecallEval(rReal, dataset, 'hybrid');
    const fullMorto = await runRecallEval(rMorto, dataset, 'hybrid');
    const semReal = await runRecallEval(rReal, { ...dataset, cases: semanticCases }, 'hybrid');
    const semMorto = await runRecallEval(rMorto, { ...dataset, cases: semanticCases }, 'hybrid');
    const semVetReal = await runRecallEval(rReal, { ...dataset, cases: semanticCases }, 'vector');
    const semVetMorto = await runRecallEval(rMorto, { ...dataset, cases: semanticCases }, 'vector');

    const f = (n: number) => n.toFixed(2);
    console.log('\n@@RESULTADO@@');
    console.log(`  dataset completo (gate 0.85) hibrido: real=${f(fullReal.recallAt5)}  morto=${f(fullMorto.recallAt5)}  discrimina=${fullReal.recallAt5 > fullMorto.recallAt5}`);
    console.log(`  semantic_cases               hibrido: real=${f(semReal.recallAt5)}  morto=${f(semMorto.recallAt5)}  discrimina=${semReal.recallAt5 > semMorto.recallAt5}`);
    console.log(`  semantic_cases               vetorial: real=${f(semVetReal.recallAt5)}  morto=${f(semVetMorto.recallAt5)}  discrimina=${semVetReal.recallAt5 > semVetMorto.recallAt5}`);
    console.log(`  n casos: completo=${dataset.cases.length} semanticos=${semanticCases.length}`);
    console.log('@@FIM@@\n');
  }, 300_000);
});
