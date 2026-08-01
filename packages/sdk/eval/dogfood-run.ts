/**
 * Exercita o `RemoteSkillsManager` contra um registry REAL (M7 DoD #3, parcial).
 *
 * O que este script é, e o que ele NÃO é — a distinção importa porque o DoD pede dogfood:
 *
 *  - **É** uso real do provider contra um servidor de verdade, pela rede, com medição de
 *    latência e de acerto. Nada aqui é mock.
 *  - **NÃO é** um agente Theokit interno em uso continuado. Isso é comportamento humano ao
 *    longo do tempo, não um script — e o gate `/dogfood` deste ecossistema existe justamente
 *    para impedir que se afirme "está em uso" com base numa execução automatizada.
 *
 * Portanto ele produz EVIDÊNCIA, não conclusão. O checkbox do M7 continua aberto até haver
 * uso observado; o que este script entrega é o instrumento e o primeiro dado.
 *
 * Uso:  THEOSKILL_REGISTRY=http://host:18087 pnpm -C packages/sdk eval:dogfood
 */
import { withWorkspace } from '../src/client.js';
import { createRemoteSkillsManager } from '../src/remote-skills-manager.js';

interface Caso {
  readonly intencao: string;
  /** Nome esperado no topo — o acerto que o Recall@5 mede. */
  readonly esperado: string;
}

const CASOS: readonly Caso[] = [
  { intencao: 'como reconciliar faturamento do trimestre', esperado: 'ledger-reconciler' },
  { intencao: 'ajustar o autoscaler do cluster kubernetes', esperado: 'autoscaler-tuner' },
];

function p95(ms: readonly number[]): number {
  const ord = [...ms].sort((a, b) => a - b);
  return ord[Math.max(0, Math.ceil(0.95 * ord.length) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const registry = process.env['THEOSKILL_REGISTRY'];
  if (registry === undefined || registry === '') {
    process.stderr.write('THEOSKILL_REGISTRY é obrigatório — o dogfood roda contra um registry real.\n');
    process.exit(2);
  }

  const auth = process.env['THEOSKILL_AUTH'];
  const client = withWorkspace({
    baseUrl: registry,
    ...(auth !== undefined ? { auth } : {}),
    attempts: 2,
  });

  const degradacoes: string[] = [];
  const manager = createRemoteSkillsManager({
    client,
    onDegraded: (m) => degradacoes.push(m),
    // LIGADO aqui, e é o ponto: sem isto o runner media um caminho que nunca chama
    // `instructions()` — ou seja, media a busca e chamava aquilo de evidência da carga
    // remota. O texto de indisponibilidade seguia preenchendo `instructions`, exatamente o
    // que o M24 existe para substituir.
    loadInstructions: true,
  });

  const latencias: number[] = [];
  let acertos = 0;

  process.stdout.write(`\nDogfood do RemoteSkillsManager contra ${registry}\n\n`);

  for (const caso of CASOS) {
    const t0 = performance.now();
    // Cache desligado na prática: cada intenção é distinta, então toda chamada vai à rede.
    const skills = await manager.resolve(caso.intencao, 5);
    latencias.push(performance.now() - t0);

    const nomes = skills.map((s) => s.name);
    const acertou = nomes.includes(caso.esperado);
    if (acertou) acertos += 1;
    process.stdout.write(
      `${acertou ? 'HIT ' : 'MISS'}  "${caso.intencao}"\n      -> ${nomes.length > 0 ? nomes.join(', ') : '(vazio)'}\n`,
    );
  }

  const recall = CASOS.length === 0 ? 0 : acertos / CASOS.length;
  process.stdout.write(`\ncasos      : ${String(CASOS.length)}\n`);
  process.stdout.write(`recall@5   : ${recall.toFixed(3)}\n`);
  process.stdout.write(`p95        : ${p95(latencias).toFixed(1)} ms\n`);
  process.stdout.write(`degradações: ${String(degradacoes.length)}${degradacoes.length > 0 ? ` (${degradacoes.join('; ')})` : ''}\n`);

  process.stdout.write(
    `\nEVIDÊNCIA, não conclusão: isto é uso real do provider contra um servidor real, e NÃO é\n` +
      `um agente Theokit em uso continuado. O M7 item 3 permanece aberto até haver uso observado.\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
