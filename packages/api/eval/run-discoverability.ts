/**
 * M34 — o gate de descobribilidade.
 *
 * Roda o dataset versionado contra o ACERVO REAL e **reprova quando uma skill que era found
 * deixa de ser**. É o critério que distingue este eval de um relatório: sem o gate, uma regressão
 * de descoberta passa despercebida até um usuário reclamar que "sumiu".
 *
 * Uso:
 *   THEOSKILL_PG_URI=… npx tsx eval/run-discoverability.ts [--baseline eval/.discoverability-baseline.json]
 *
 * Saída: exit 0 quando nenhum testCase regrediu; exit 1 quando algum regrediu.
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
  // handler não devolve (é `results`) — e por isso achava zero em toda query, gravava uma
  // baseline de zeros e deixava o gate INERTE: não há regressão possível a partir de "nunca
  // found". Nada em `eval/` é alcançado por teste, que é como o defeito sobreviveu.
  return idsDaResposta(await res.json());
}

/** A skill expected ainda está no acervo? 404 é resposta, não erro. */
async function existsInRegistry(skillId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/v1/skills/${encodeURIComponent(skillId)}`, {
    headers: TOKEN === '' ? {} : { authorization: `Bearer ${TOKEN}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`get skill ${res.status} para "${skillId}"`);
  return true;
}

async function main(): Promise<void> {
  const baselinePath =
    process.argv.includes('--baseline')
      ? (process.argv[process.argv.indexOf('--baseline') + 1] ?? '')
      : 'eval/.discoverability-baseline.json';

  const dataset = JSON.parse(readFileSync('eval/discoverability-dataset.json', 'utf8')) as Dataset;

  const results: Resultado[] = [];
  for (const testCase of dataset.cases) {
    const ids = await buscar(testCase.query);
    const i = ids.indexOf(testCase.expect_skill_id);
    results.push({
      query: testCase.query,
      expected: testCase.expect_skill_id,
      found: i !== -1,
      position: i === -1 ? null : i + 1,
      // Rodando contra o acervo REAL, uma skill do dataset pode ter sido apagada. Sem esta
      // query, "sumiu do acervo" e "exists e não foi found" chegariam ao gate como o mesmo
      // fato — e ele acusaria a busca por uma decisão de curadoria.
      exists: await existsInRegistry(testCase.expect_skill_id),
    });
  }

  const present = results.filter((r) => r.exists !== false);
  const absent = results.filter((r) => r.exists === false);
  const foundCount = present.filter((r) => r.found).length;

  console.log(`dataset v${dataset.version} (${dataset.dated}) — ${foundCount}/${present.length} found`);
  for (const r of results) {
    const mark = r.exists === false ? 'fora' : r.found ? `#${r.position}` : '  —';
    console.log(`  ${mark}  ${r.expected}  ←  "${r.query}"`);
  }
  if (absent.length > 0) {
    // Visível, e deliberadamente NÃO fatal: um dataset envelhecendo é informação para quem o
    // mantém, não motivo para derrubar o gate de quem mexeu na busca.
    console.log(
      `\n${absent.length} testCase(s) apontam para skill fora do acervo — o dataset envelheceu ` +
        `em relação a ele. Não contam como regressão.`,
    );
  }

  // ---- O GATE: regressão REPROVA -----------------------------------------------------------
  //
  // Comparar contra um piso absoluto (ex.: "recall ≥ 0.8") mediria o embedder, não a mudança.
  // What matters to the author is: **does what used to be found still get found?**
  if (!existsSync(baselinePath)) {
    writeFileSync(baselinePath, JSON.stringify(results, null, 2));
    console.log(`\nbaseline criada em ${baselinePath} — a próxima execução compara contra ela.`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Resultado[];
  const regressions = detectarRegressoes(results, baseline);

  if (regressions.length > 0) {
    console.error(`\nREGRESSION: ${regressions.length} skill(s) stopped being found:`);
    for (const r of regressions) console.error(`  ${r.expected}  ←  "${r.query}"`);
    process.exit(1);
  }

  console.log('\nno regression — what used to be found still is.');
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
