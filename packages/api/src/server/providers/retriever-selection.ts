import {
  createHybridRetriever,
  createKeywordRetriever,
  createVectorRetriever,
  type EmbeddingProvider,
  type QueryExecutor,
  type RetrieveParams,
  type RetrievedSkill,
  type RetrieveStrategy,
  type SkillRetriever,
} from '@usetheo/skills';

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
      return byStrategy[params.strategy].retrieve(params);
    },
  };
}
