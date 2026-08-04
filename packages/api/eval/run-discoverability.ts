/**
 * M34 — o gate de descobribilidade.
 *
 * Roda o dataset versionado contra o ACERVO REAL e **reprova quando uma skill que era achada
 * deixa de ser**. É o critério que distingue este eval de um relatório: sem o gate, uma regressão
 * de descoberta passa despercebida até um usuário reclamar que "sumiu".
 *
 * Uso:
 *   THEOSKILL_PG_URI=… npx tsx eval/run-discoverability.ts [--baseline eval/.discoverability-baseline.json]
 *
 * Saída: exit 0 quando nenhum caso regrediu; exit 1 quando algum regrediu.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { detectarRegressoes, type ResultadoEval } from '../src/eval/regression-gate.js';
import { idsDaResposta } from '../src/eval/retrieve-response.js';

interface Caso {
  readonly query: string;
  readonly expect_skill_id: string;
}

interface Dataset {
  readonly version: number;
  readonly dated: string;
  readonly cases: readonly Caso[];
}

type Resultado = ResultadoEval;

const BASE = process.env['THEOSKILL_BASE_URL'] ?? 'http://127.0.0.1:8080';
const TOKEN = process.env['THEOSKILL_TOKEN'] ?? '';

async function buscar(query: string): Promise<string[]> {
  const url = `${BASE}/v1/skills:retrieve?query=${encodeURIComponent(query)}&top_k=5`;
  const res = await fetch(url, {
    headers: TOKEN === '' ? {} : { authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`retrieve ${res.status} para "${query}"`);
  // A leitura mora em `src/eval/` e é TESTADA. Aqui dentro ela lia `body.skills` — chave que o
  // handler não devolve (é `results`) — e por isso achava zero em toda consulta, gravava uma
  // baseline de zeros e deixava o gate INERTE: não há regressão possível a partir de "nunca
  // achada". Nada em `eval/` é alcançado por teste, que é como o defeito sobreviveu.
  return idsDaResposta(await res.json());
}

async function main(): Promise<void> {
  const baselinePath =
    process.argv.includes('--baseline')
      ? (process.argv[process.argv.indexOf('--baseline') + 1] ?? '')
      : 'eval/.discoverability-baseline.json';

  const dataset = JSON.parse(readFileSync('eval/discoverability-dataset.json', 'utf8')) as Dataset;

  const resultados: Resultado[] = [];
  for (const caso of dataset.cases) {
    const ids = await buscar(caso.query);
    const i = ids.indexOf(caso.expect_skill_id);
    resultados.push({
      query: caso.query,
      esperada: caso.expect_skill_id,
      achada: i !== -1,
      posicao: i === -1 ? null : i + 1,
    });
  }

  const achados = resultados.filter((r) => r.achada).length;
  console.log(`dataset v${dataset.version} (${dataset.dated}) — ${achados}/${resultados.length} achadas`);
  for (const r of resultados) {
    console.log(`  ${r.achada ? `#${r.posicao}` : '  —'}  ${r.esperada}  ←  "${r.query}"`);
  }

  // ---- O GATE: regressão REPROVA -----------------------------------------------------------
  //
  // Comparar contra um piso absoluto (ex.: "recall ≥ 0.8") mediria o embedder, não a mudança.
  // O que interessa ao autor é: **o que era achado continua sendo?**
  if (!existsSync(baselinePath)) {
    writeFileSync(baselinePath, JSON.stringify(resultados, null, 2));
    console.log(`\nbaseline criada em ${baselinePath} — a próxima execução compara contra ela.`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Resultado[];
  const regressoes = detectarRegressoes(resultados, baseline);

  if (regressoes.length > 0) {
    console.error(`\nREGRESSÃO: ${regressoes.length} skill(s) deixaram de ser achadas:`);
    for (const r of regressoes) console.error(`  ${r.esperada}  ←  "${r.query}"`);
    process.exit(1);
  }

  console.log('\nnenhuma regressão — o que era achado continua sendo.');
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
