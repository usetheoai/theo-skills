/**
 * M34 — a detecção de regressão do gate de descobribilidade.
 *
 * Vive separada do runner porque é a **regra**, e regra se testa sem rede nem banco. O runner
 * cuida de I/O; isto decide.
 */

export interface ResultadoEval {
  readonly query: string;
  readonly esperada: string;
  readonly achada: boolean;
  readonly posicao: number | null;
}

/**
 * Devolve os casos que **eram achados e deixaram de ser**.
 *
 * Três não-regressões, deliberadas:
 *
 *  - **Nunca achada** é falha conhecida, não piora. Tratá-la como regressão faria o gate reprovar
 *    para sempre por um caso que nunca passou — e um gate que reprova sempre é um gate que se
 *    desliga.
 *  - **Passou a ser achada** é melhora.
 *  - **Caso novo** não tem estado anterior; chamá-lo de regressão puniria quem amplia a cobertura
 *    do dataset.
 *
 * A identidade de um caso é o par (consulta, skill esperada): a mesma skill pode ser achada por
 * uma frase e não por outra, e é essa diferença que o dataset existe para capturar.
 */
export function detectarRegressoes(
  agora: readonly ResultadoEval[],
  baseline: readonly ResultadoEval[],
): ResultadoEval[] {
  return agora.filter((r) => {
    const antes = baseline.find((b) => b.query === r.query && b.esperada === r.esperada);
    return antes?.achada === true && !r.achada;
  });
}
