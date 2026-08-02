import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createId } from '@paralleldrive/cuid2';
import { createOpenAIEmbedder, DEFAULT_WORKSPACE_ID, type EmbeddingProvider } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { type EvalDataset, runRecallEval } from '../../eval/run-recall.js';
import { DEFAULT_RETRIEVE_TIMEOUT_MS } from '../../src/server/app.js';
import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * Gate de latência da DESCOBERTA — o caminho que a produção percorre (LT-042).
 *
 * O gate vizinho (`m4-recall`, "p95 < 200ms") roda com `createStubEmbedder`: hash local, zero
 * rede. Ele mede o banco, não a descoberta — e por isso ficou **verde durante os 9,3 s** que a
 * produção levava no LT-026. Um teto afirmado sobre um caminho que não se exercita não é gate,
 * é decoração.
 *
 * Duas decisões que sustentam este arquivo:
 *
 * 1. **O teto vem do LT-029, não de um número inventado.** `DEFAULT_RETRIEVE_TIMEOUT_MS` é o
 *    limite que a própria seleção de estratégia aplica por requisição — acima dele a busca é
 *    cortada. Afirmar um p95 MAIOR que o teto seria afirmar o impossível; afirmar um p95
 *    arbitrariamente menor (200 ms) seria inventar um SLO que a chamada de embedding não pode
 *    cumprir. O gate certo é: **cabe dentro do teto que o produto promete**.
 * 2. **Não pode passar por vacuidade.** Trocar o embedder real pelo stub faria o p95 despencar
 *    e o gate "passar" sem nunca ter tocado a rede — exatamente o defeito que este arquivo
 *    veio corrigir. Por isso a asserção de proveniência: o provider TEM de ser `openai`.
 */
const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../eval/dataset.json', import.meta.url)), 'utf8'),
) as EvalDataset;

const TEM_CHAVE = (process.env['OPENAI_API_KEY'] ?? '').trim() !== '';
const PULAR_PEDIDO = (process.env['THEOSKILL_SKIP_REAL_EMBED'] ?? '') !== '';

/**
 * A suíte de integração vai mesmo rodar? Só faz sentido exigir a chave se sim.
 *
 * Sem esta condição o guard abaixo dispara mesmo quando a integração inteira foi dispensada
 * (`THEOSKILL_SKIP_INTEGRATION=1`, o caminho de quem não tem Postgres local) — e aí ele
 * derruba com exit 1 uma execução que o contrato manda sair 0. Foi o que quebrou o
 * `integration-gate.contract.test.ts`: eu empilhei um segundo portão sobre um opt-out que já
 * existia, em vez de respeitá-lo.
 */
const INTEGRACAO_VAI_RODAR =
  (process.env['THEOSKILL_PG_URI'] ?? '') !== '' && (process.env['THEOSKILL_SKIP_INTEGRATION'] ?? '') === '';

/**
 * Sem chave o gate NÃO passa em silêncio — mesmo motivo de `_helpers/env.ts`: um portão que
 * não mede nada e diz "passou" é pior que portão nenhum. Pular vira decisão de quem pediu.
 */
if (INTEGRACAO_VAI_RODAR && !TEM_CHAVE && !PULAR_PEDIDO) {
  throw new Error(
    'OPENAI_API_KEY ausente — este gate mede o caminho REAL da descoberta e não mediria nada.\n' +
      '  • Para RODAR: OPENAI_API_KEY=... pnpm test:integration\n' +
      '  • Para PULAR: THEOSKILL_SKIP_REAL_EMBED=1 pnpm test:integration\n' +
      'Pular em silêncio é como o gate de 200 ms ficou verde durante os 9,3 s do LT-026.',
  );
}

const embedder: EmbeddingProvider = createOpenAIEmbedder({});

(TEM_CHAVE ? describeIntegration : describeIntegration.skip)('latência da descoberta pelo caminho REAL (LT-042)', () => {
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
      const v = await embedder.embed(searchText);
      await pool.query(
        `INSERT INTO embeddings (id, workspace_id, revision_id, skill_id, provider, model, dimensions, vector) VALUES ($1,$2,$3,$4,$5,$6,1536,$7::vector)`,
        [`emb_${createId()}`, DEFAULT_WORKSPACE_ID, revisionId, s.skill_id, embedder.provider, embedder.model, `[${v.join(',')}]`],
      );
    }
  }, 180_000);
  afterAll(closePool);

  it('NÃO passa por vacuidade: o gate só vale se o embedder exercitado for o real', () => {
    // A asserção que mata a implementação errada. Um gate de latência que aceita o stub
    // "passa" sempre — o hash é local e nunca chega perto de teto nenhum. Trocar o provider
    // por `stub` para "estabilizar o teste" derrubaria esta linha, que é o ponto.
    expect(embedder.provider).toBe('openai');
    expect(embedder.model).toMatch(/^text-embedding-/);
  });

  it('p95 da descoberta cabe dentro do teto que o produto promete (LT-029)', async () => {
    const retriever = createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    await runRecallEval(retriever, dataset, 'hybrid'); // aquece
    const r = await runRecallEval(retriever, dataset, 'hybrid');

    // O teto é o do LT-029 — acima dele a requisição é CORTADA, então um p95 maior significa
    // que a descoberta estoura o próprio limite do produto. Não é SLO de produção: é a
    // afirmação de que o caminho real cabe no que prometemos.
    expect(
      r.p95Ms,
      `p95=${String(Math.round(r.p95Ms))}ms estourou o teto de ${String(DEFAULT_RETRIEVE_TIMEOUT_MS)}ms (LT-029) — ` +
        'a descoberta não cabe no limite que o próprio produto aplica por requisição.',
    ).toBeLessThan(DEFAULT_RETRIEVE_TIMEOUT_MS);

    // E o piso: se o p95 desabar para a ordem de grandeza do stub, alguém trocou o caminho
    // sem trocar o nome do teste. Uma chamada de rede não custa 5 ms.
    expect(
      r.p95Ms,
      'p95 abaixo de 50ms com embedder "real" — isto não é rede. Verifique se o provider foi trocado.',
    ).toBeGreaterThan(50);
  }, 180_000);

  it('GATE DE RECALL ancorado no conjunto que DISCRIMINA — e prova os dois sentidos', async () => {
    // LT-035, re-entrega. O gate antigo usava o dataset COMPLETO e media 1.00 com embedding
    // vivo e 1.00 com embedding MORTO — idênticos. Continuava cego ao motor, que era o defeito
    // original, só que com casos diferentes: num conjunto onde a maioria casa por léxico, a
    // média passa mesmo com a perna vetorial morta. O agregado DILUI.
    //
    // O conjunto `semantic_cases` (sinônimos, sobreposição léxica zero por construção) dá 1.00
    // com vivo e 0.00 com morto. É nele que o gate tem poder de reprovar, e é nele que o gate
    // passa a viver.
    const sem = { ...dataset, cases: dataset.semantic_cases ?? [] };
    expect(sem.cases.length, 'sem casos semânticos não há gate').toBeGreaterThanOrEqual(5);

    const vivo = await runRecallEval(
      createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder, workspaceId: DEFAULT_WORKSPACE_ID }),
      sem,
      'hybrid',
    );
    // SENTIDO 1 — com o motor vivo, o portão passa.
    expect(
      vivo.recallAt5,
      `recall semântico=${String(vivo.recallAt5)} com embedder real — abaixo do piso, a descoberta por intenção regrediu`,
    ).toBeGreaterThanOrEqual(0.85);

    // SENTIDO 2 — com o motor MORTO, o portão REPROVA. Sem esta metade o gate volta a ser o
    // que era: um número que só sabe dizer sim.
    const morto: EmbeddingProvider = {
      provider: 'stub',
      model: 'constante-sem-significado',
      embed: () => Promise.resolve(new Array<number>(1536).fill(0.001)),
      embedBatch: (t: string[]) => Promise.resolve(t.map(() => new Array<number>(1536).fill(0.001))),
    };
    const comMotorMorto = await runRecallEval(
      createDispatchingRetriever({ executor: createPgExecutor(getPool()), embedder: morto, workspaceId: DEFAULT_WORKSPACE_ID }),
      sem,
      'hybrid',
    );
    expect(
      comMotorMorto.recallAt5,
      `com embedding morto o recall foi ${String(comMotorMorto.recallAt5)} — o portão NÃO reprovou, ` +
        'logo não mede descoberta por intenção. É o defeito do LT-035 de volta.',
    ).toBeLessThan(0.85);
  }, 180_000);
});
