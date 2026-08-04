/**
 * M34 — diagnóstico de descobribilidade: a skill é achada pela intenção que deveria encontrá-la?
 *
 * O `:validate` do M30 responde se a skill é **válida**. Nada respondia se ela é **achável**, que
 * é a promessa do produto — e a diferença importa porque uma skill válida e inachável é, para
 * quem procura, indistinguível de uma que não existe.
 *
 * **O resultado nomeia a CAUSA, não só o número.** Um recall sem diagnóstico não diz ao autor o
 * que corrigir: ele lê `0.3` e não sabe se o problema é a descrição, a falta de vetor, ou uma
 * vizinha que rouba a consulta. As três exigem correções opostas.
 *
 * **Nada aqui executa a skill.** Não invoca script, não abre sandbox, não carrega runtime — a
 * fronteira "execução é responsabilidade do Theokit" permanece intacta, e este módulo é puro:
 * recebe metadados e vizinhas já medidas, devolve diagnóstico.
 */

/** Vocabulário FECHADO de causas. Um rótulo novo é decisão de produto, não detalhe de código. */
export const DISCOVERABILITY_CAUSES = {
  /** A descrição não diz QUANDO usar a skill — só o que ela é. */
  DESCRIPTION_TOO_GENERIC: 'description_too_generic',
  /** Sem vetor: a skill só aparece para quem já sabe o nome. */
  NO_EMBEDDING: 'no_embedding',
  /** Outra skill do acervo ocupa o mesmo espaço semântico e vai roubar a consulta. */
  COLLIDES_WITH_SIBLING: 'collides_with_sibling',
} as const;

export type DiscoverabilityCause =
  (typeof DISCOVERABILITY_CAUSES)[keyof typeof DISCOVERABILITY_CAUSES];

/** Uma skill do acervo e o quanto ela se parece com a candidata. */
export interface CandidataVizinha {
  readonly skillId: string;
  /** 0..1 — quanto maior, mais as duas disputam a mesma consulta. */
  readonly similaridade: number;
}

export interface EntradaDiagnostico {
  readonly name: string;
  readonly description: string;
  /** Se a revisão vigente tem vetor. Ausência de vetor não é ausência de skill. */
  readonly hasEmbedding: boolean;
  readonly vizinhas: readonly CandidataVizinha[];
}

export interface Diagnostico {
  readonly discoverable: boolean;
  readonly causes: DiscoverabilityCause[];
  /** O que FAZER, por causa. Sem isto o autor lê o rótulo e continua sem o próximo passo. */
  readonly hints: string[];
}

/**
 * Piso de caracteres para a descrição.
 *
 * HEURÍSTICO, e declaro: não existe número certo. Sessenta caracteres é aproximadamente o
 * tamanho de uma frase que diz o que a skill faz **e quando usá-la** — que é o que a busca
 * vetorial precisa para distinguir intenções. Abaixo disso, a descrição tende a nomear a
 * categoria em vez de descrever o caso de uso.
 *
 * A consequência de errar para menos é ruído (acusar descrição boa); para mais, silêncio (deixar
 * passar descrição ruim). Preferimos o silêncio: um detector que reclama de tudo é indistinguível
 * de nenhum detector, e o autor aprende a ignorá-lo.
 */
const PISO_DESCRICAO = 60;

/**
 * Acima disto, duas skills disputam a mesma consulta.
 *
 * HEURÍSTICO. `0.90` é alto de propósito: abaixo dele, similaridade semântica é o normal num
 * acervo coeso — skills do mesmo domínio SE PARECEM, e acusar isso transformaria coesão em
 * defeito.
 */
const PISO_COLISAO = 0.9;

/**
 * Diagnostica sem executar nada.
 *
 * As causas **se acumulam**: reportar só a primeira faria o autor corrigir uma, republicar, e
 * descobrir a seguinte — um ciclo de publicação por defeito. A ordem é fixa para que o relatório
 * não dance entre execuções.
 */
export function diagnosticarDescobribilidade(entrada: EntradaDiagnostico): Diagnostico {
  const causes: DiscoverabilityCause[] = [];
  const hints: string[] = [];

  const descricao = entrada.description.trim();
  if (descricao.length < PISO_DESCRICAO) {
    causes.push(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
    hints.push(
      'A descrição diz o que a skill é, mas não QUANDO usá-la. Escreva a situação em que um agente deveria escolhê-la — é isso que a busca por intenção compara.',
    );
  }

  if (!entrada.hasEmbedding) {
    causes.push(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
    hints.push(
      'A revisão vigente não tem vetor: a skill só aparece para quem já sabe o nome dela. Republique para gerar o vetor, ou verifique se a ingestão falhou.',
    );
  }

  // A vizinha mais próxima é a que de fato rouba a consulta — reportar todas acima do piso
  // encheria o diagnóstico sem acrescentar decisão.
  const rival = [...entrada.vizinhas]
    .filter((v) => v.similaridade >= PISO_COLISAO)
    .sort((a, b) => b.similaridade - a.similaridade)[0];

  if (rival !== undefined) {
    causes.push(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
    hints.push(
      `Ocupa quase o mesmo espaço semântico de \`${rival.skillId}\` (${rival.similaridade.toFixed(2)}): as duas disputam as mesmas consultas, e a busca vai preferir uma delas de forma pouco previsível. Diferencie as descrições, ou descontinue a que saiu de uso.`,
    );
  }

  return { discoverable: causes.length === 0, causes, hints };
}
