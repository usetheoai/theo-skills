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
 * recebe metadados e neighbours já medidas, devolve diagnóstico.
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
export interface NeighbourCandidate {
  readonly skillId: string;
  /** 0..1 — quanto maior, mais as duas disputam a mesma consulta. */
  readonly similarity: number;
}

/**
 * O estado de publicação da candidata — e, só quando published, se a revisão tem vetor.
 *
 * União discriminada em vez de um `hasEmbedding: boolean` porque **"não published e com vetor"
 * não existe**: vetor é propriedade de uma revisão, e um rascunho não tem revisão. Com o booleano
 * plano esse estado era representável, e a consequência apareceu em produção — a tela de autoria
 * mandava `false` para um rascunho e o diagnóstico o acusava de não ter vetor (theo-skills#144).
 *
 * A distinção não é formal: ela muda qual pergunta está sendo respondida.
 *
 * | | Pergunta do autor | `no_embedding` significa |
 * |---|---|---|
 * | rascunho | "minha descrição está boa?" | nada — ele não tem revisão |
 * | published | "por que não me acham?" | achado real: a ingestão falhou ou não rodou |
 */
export type RevisionState =
  | { readonly published: false }
  | { readonly published: true; readonly hasVector: boolean };

export interface DiscoverabilityInput {
  readonly name: string;
  readonly description: string;
  readonly revision: RevisionState;
  readonly neighbours: readonly NeighbourCandidate[];
}

export interface DiscoverabilityReport {
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
 * HEURÍSTICO. `0.90` é alto de propósito: abaixo dele, similarity semântica é o normal num
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
export function diagnoseDiscoverability(entrada: DiscoverabilityInput): DiscoverabilityReport {
  const causes: DiscoverabilityCause[] = [];
  const hints: string[] = [];

  const descricao = entrada.description.trim();
  if (descricao.length < PISO_DESCRICAO) {
    causes.push(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
    hints.push(
      'The description says what the skill is, but not WHEN to use it. Write the situation in which an agent should pick it — that is what intent search compares against.',
    );
  }

  // Falta de vetor só é ACHADO quando há revisão published para tê-lo. Num rascunho, acusá-la
  // seria reportar como defeito uma consequência de ainda não ter publicado — e, pior, essa
  // causa dispararia SEMPRE, encobrindo as duas que o autor pode corrigir agora.
  if (entrada.revision.published && !entrada.revision.hasVector) {
    causes.push(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
    hints.push(
      'The current revision has no vector: the skill only shows up for whoever already knows its name. Republish to generate the vector, or check whether ingestion failed.',
    );
  }

  // A vizinha mais próxima é a que de fato rouba a consulta — reportar todas acima do piso
  // encheria o diagnóstico sem acrescentar decisão.
  const rival = [...entrada.neighbours]
    .filter((v) => v.similarity >= PISO_COLISAO)
    .sort((a, b) => b.similarity - a.similarity)[0];

  if (rival !== undefined) {
    causes.push(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
    hints.push(
      `Occupies almost the same semantic space as \`${rival.skillId}\` (${rival.similarity.toFixed(2)}): both compete for the same queries, and search will favour one of them unpredictably. Differentiate the descriptions, or deprecate the one that fell out of use.`,
    );
  }

  // Um rascunho sem causa alguma NÃO é achável hoje — ele não existe no acervo. Devolver o
  // veredito limpo e calar sobre isso deixaria o autor com a impressão de que já está resolvido.
  // A ressalva vai no hint, não numa causa: causa é problema a corrigir, e não haver publicado
  // ainda é o estado normal de quem está escrevendo.
  if (!entrada.revision.published && causes.length === 0) {
    hints.push(
      'Nothing to fix in the description. The skill is not in the registry yet — once published, ingestion generates the vector and it becomes findable by intent.',
    );
  }

  return { discoverable: causes.length === 0, causes, hints };
}
