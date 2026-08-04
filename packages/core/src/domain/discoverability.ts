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

/**
 * O estado de publicação da candidata — e, só quando publicada, se a revisão tem vetor.
 *
 * União discriminada em vez de um `hasEmbedding: boolean` porque **"não publicada e com vetor"
 * não existe**: vetor é propriedade de uma revisão, e um rascunho não tem revisão. Com o booleano
 * plano esse estado era representável, e a consequência apareceu em produção — a tela de autoria
 * mandava `false` para um rascunho e o diagnóstico o acusava de não ter vetor (theo-skills#144).
 *
 * A distinção não é formal: ela muda qual pergunta está sendo respondida.
 *
 * | | Pergunta do autor | `no_embedding` significa |
 * |---|---|---|
 * | rascunho | "minha descrição está boa?" | nada — ele não tem revisão |
 * | publicada | "por que não me acham?" | achado real: a ingestão falhou ou não rodou |
 */
export type EstadoDaRevisao =
  | { readonly publicada: false }
  | { readonly publicada: true; readonly temVetor: boolean };

export interface EntradaDiagnostico {
  readonly name: string;
  readonly description: string;
  readonly revisao: EstadoDaRevisao;
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

  // Falta de vetor só é ACHADO quando há revisão publicada para tê-lo. Num rascunho, acusá-la
  // seria reportar como defeito uma consequência de ainda não ter publicado — e, pior, essa
  // causa dispararia SEMPRE, encobrindo as duas que o autor pode corrigir agora.
  if (entrada.revisao.publicada && !entrada.revisao.temVetor) {
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

  // Um rascunho sem causa alguma NÃO é achável hoje — ele não existe no acervo. Devolver o
  // veredito limpo e calar sobre isso deixaria o autor com a impressão de que já está resolvido.
  // A ressalva vai no hint, não numa causa: causa é problema a corrigir, e não haver publicado
  // ainda é o estado normal de quem está escrevendo.
  if (!entrada.revisao.publicada && causes.length === 0) {
    hints.push(
      'Nada a corrigir na descrição. A skill ainda não está no acervo — ao publicar, a ingestão gera o vetor e ela passa a ser encontrada por intenção.',
    );
  }

  return { discoverable: causes.length === 0, causes, hints };
}
