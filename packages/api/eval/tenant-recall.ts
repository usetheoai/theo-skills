/**
 * Mede Recall@5 e p95 do retrieve SOB filtro de tenant, com o índice populado por vários
 * workspaces — a condição que o risco #1 do M11 descreve ("o índice `hnsw` é global;
 * filtrar ANN por `workspace_id` é o problema clássico de pre-filter vs post-filter").
 *
 * Existe como SCRIPT, e não apenas como teste, por duas razões:
 *  - o número precisa ser transcrito para o ADR, e um `console.log` dentro do vitest é
 *    engolido pelo reporter;
 *  - M19 e M21 medem de novo (canais e telemetria mexem no mesmo caminho), então a
 *    medição tem de ser repetível por quem não escreveu o teste.
 *
 * Uso:  THEOSKILL_PG_URI=... pnpm -C packages/api eval:tenant [n_tenants]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createStubEmbedder } from '@usetheo/skills';
import { Pool } from 'pg';

import { createDispatchingRetriever } from '../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../src/server/retrieve/pg-executor.js';

import { type EvalDataset, runRecallEval, seedDataset } from './run-recall.js';

const WS_TARGET = 'ws_measured';

async function main(): Promise<void> {
  const uri = process.env['THEOSKILL_PG_URI'];
  if (uri === undefined || uri === '') {
    process.stderr.write('THEOSKILL_PG_URI é obrigatório — a medição roda contra pgvector real.\n');
    process.exit(2);
  }
  const tenants = Number(process.argv[2] ?? '5');
  const dataset = JSON.parse(
    readFileSync(fileURLToPath(new URL('./dataset.json', import.meta.url)), 'utf8'),
  ) as EvalDataset;

  const pool = new Pool({ connectionString: uri });
  try {
    // Limpa só o que esta medição escreve — não usa truncate global, para poder rodar
    // contra um banco que tenha outros dados sem destruí-los.
    const wsList = [WS_TARGET, ...Array.from({ length: tenants - 1 }, (_, i) => `ws_noise_${String(i + 1)}`)];
    for (const ws of wsList) {
      await pool.query('DELETE FROM embeddings WHERE workspace_id = $1', [ws]);
      await pool.query('DELETE FROM skill_revisions WHERE workspace_id = $1', [ws]);
      await pool.query('DELETE FROM skills WHERE workspace_id = $1', [ws]);
    }
    for (const ws of wsList) await seedDataset(pool, dataset, ws);

    const retriever = createDispatchingRetriever({
      executor: createPgExecutor(pool),
      embedder: createStubEmbedder(),
      workspaceId: WS_TARGET,
    });

    await runRecallEval(retriever, dataset, 'hybrid'); // warm
    const hybrid = await runRecallEval(retriever, dataset, 'hybrid');
    const keyword = await runRecallEval(retriever, dataset, 'keyword');
    const vector = await runRecallEval(retriever, dataset, 'vector');

    const rows = [
      ['hybrid', hybrid],
      ['keyword', keyword],
      ['vector', vector],
    ] as const;

    process.stdout.write(`\nM11 — retrieve sob filtro de tenant\n`);
    process.stdout.write(`tenants no índice: ${String(wsList.length)}  |  skills/tenant: ${String(dataset.skills.length)}`);
    process.stdout.write(`  |  linhas totais: ${String(wsList.length * dataset.skills.length)}\n`);
    process.stdout.write(`casos de avaliação: ${String(dataset.cases.length)}\n\n`);
    process.stdout.write(`estratégia   recall@5   p95(ms)\n`);
    for (const [name, r] of rows) {
      process.stdout.write(`${name.padEnd(12)} ${r.recallAt5.toFixed(3).padStart(8)}   ${r.p95Ms.toFixed(1).padStart(7)}\n`);
    }
    process.stdout.write(`\ngate M4: recall@5 >= 0.85, p95 < 200ms\n`);
    process.stdout.write(
      `hybrid: recall ${hybrid.recallAt5 >= 0.85 ? 'PASSA' : 'REPROVA'}, p95 ${hybrid.p95Ms < 200 ? 'PASSA' : 'REPROVA'}\n`,
    );
    if (hybrid.misses.length > 0) process.stdout.write(`misses: ${hybrid.misses.join(' | ')}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
