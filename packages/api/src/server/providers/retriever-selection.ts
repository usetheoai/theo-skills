import {
  createHybridRetriever,
  RetrieverTimeoutError,
  createKeywordRetriever,
  createVectorRetriever,
  type EmbeddingProvider,
  type QueryExecutor,
  type RetrieveParams,
  type RetrievedSkill,
  type RetrieveStrategy,
  type SkillRetriever,
} from '@usetheo/skills';

/**
 * Folga do teto por requisição sobre o teto por perna. Pequena de propósito: só o bastante
 * para que a degradação parcial do híbrido sempre vença a corrida.
 */
const MARGEM_TETO_EXTERNO_MS = 500;

/** A strategy-aware retriever: `retrieve` dispatches on `params.strategy`. */
export interface DispatchingRetriever {
  retrieve(params: RetrieveParams & { strategy: RetrieveStrategy }): Promise<RetrievedSkill[]>;
}

export interface RetrieverSelectionOptions {
  readonly executor: QueryExecutor;
  readonly embedder: EmbeddingProvider;
  /** Workspace que este dispatcher enxerga — propagado a cada estratégia. */
  readonly workspaceId: string;
  /** Per-strategy overrides (test seam). */
  readonly overrides?: Partial<Record<RetrieveStrategy, SkillRetriever>>;
  /**
   * Repassado ao híbrido para que a queda de uma perna VIRE LOG.
   *
   * Sem isto a falha vira lista vazia e a busca responde 200 com resultado pior — foi assim
   * que a descoberta semântica ficou morta em produção sem que nada acusasse.
   */
  readonly onDegraded?: (perna: 'vector' | 'keyword', err: unknown) => void;
  /** Teto por perna, repassado ao híbrido. Ausente = espera. */
  readonly timeoutMs?: number;
}

/**
 * Build a dispatcher holding one retriever per strategy and routing by
 * `params.strategy`. Mirrors `selectEmbedder` (DIP) — strategy swap never touches
 * the handler or the domain.
 */
export function createDispatchingRetriever(opts: RetrieverSelectionOptions): DispatchingRetriever {
  const vector =
    opts.overrides?.vector ??
    createVectorRetriever({ executor: opts.executor, embedder: opts.embedder, workspaceId: opts.workspaceId });
  const keyword =
    opts.overrides?.keyword ?? createKeywordRetriever({ executor: opts.executor, workspaceId: opts.workspaceId });
  const hybrid = opts.overrides?.hybrid ?? createHybridRetriever({ vector, keyword, ...(opts.onDegraded !== undefined ? { onDegraded: opts.onDegraded } : {}), ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
  const byStrategy: Record<RetrieveStrategy, SkillRetriever> = { vector, keyword, hybrid };
  return {
    retrieve(params) {
      const escolhido = byStrategy[params.strategy].retrieve(params);
      if (opts.timeoutMs === undefined || opts.timeoutMs <= 0) return escolhido;

      // TETO POR REQUISIÇÃO, na camada de SELEÇÃO — e o lugar é o ponto.
      //
      // O teto nasceu dentro do híbrido, por perna, e ali resolve a degradação PARCIAL: uma
      // perna cai, a outra responde. Mas `strategy=vector` não passava por teto algum e
      // seguia em ~10 s, medido ao vivo. A causa não era o valor: era o LUGAR. Com o teto
      // por estratégia, cada uma precisa lembrar de aplicá-lo — e a próxima esquece igual.
      // Aqui, qualquer retriever escolhido ganha teto de uma vez, inclusive um futuro.
      //
      // A MARGEM sobre o teto interno não é enfeite: sem ela os dois disparam no mesmo
      // instante e o resultado vira corrida — o híbrido, que TEM plano B, poderia falhar
      // rápido em vez de responder com a metade viva. A margem garante que o interno
      // (degradação parcial) sempre vença; este aqui é a rede de baixo, para quem não tem
      // plano B nenhum.
      const teto = opts.timeoutMs + MARGEM_TETO_EXTERNO_MS;
      return Promise.race([
        escolhido,
        new Promise<RetrievedSkill[]>((_, rej) => {
          const t = setTimeout(() => rej(new RetrieverTimeoutError(params.strategy, teto)), teto);
          (t as unknown as { unref?: () => void }).unref?.();
        }),
      ]);
    },
  };
}
