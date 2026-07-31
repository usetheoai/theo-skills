/**
 * Skill retrieval port (DIP) — hybrid lexical + vector search. Adapted from the
 * theo-rag retriever pattern (Unbreakable Rule 9). Adapters (vector/keyword/
 * hybrid) depend only on an injected `QueryExecutor` + (for vector) the M3
 * `EmbeddingProvider` — never on pg/Drizzle directly.
 */

/** Retrieval request. */
export interface RetrieveParams {
  readonly query: string;
  readonly topK: number;
  /**
   * Filtro por categoria (M23). Ausente = todas.
   *
   * É AUXILIAR da busca semântica, não substituto: estreita o espaço antes do ranqueamento
   * para o agente não varrer o catálogo inteiro. E não atravessa inquilino — a cláusula de
   * tenant continua sendo a primeira de toda consulta.
   */
  readonly category?: string;
}

/** A retrieved skill with its (strategy-dependent) relevance score. */
export interface RetrievedSkill {
  readonly skill_id: string;
  readonly score: number;
  readonly name: string;
  readonly description: string;
  /**
   * De onde veio (M14): `own` = do próprio workspace; `public` = do catálogo curado.
   *
   * Declarar a origem não é enfeite: uma skill pública é CÓDIGO DE TERCEIRO que o agente
   * vai carregar. Sem esta marca o consumidor não tem como distinguir o que o próprio time
   * publicou do que veio de fora — e essa é a decisão que ele precisa tomar.
   */
  readonly origin?: 'own' | 'public';
  /** Eixo de descoberta declarado por quem publicou (M23). Texto livre. */
  readonly category?: string;
  /**
   * Onde a skill executa (M23): `remote` = instrução, o agente CARREGA o corpo do servidor;
   * `local` = traz script e precisa ser instalada na máquina do cliente.
   *
   * Vem na DESCOBERTA, e não só no detalhe, porque é o que decide se o agente pode usar a
   * skill de onde ele está. Descobrir isso depois é descobrir seguindo passos que
   * referenciam arquivos que não existem.
   */
  readonly execution?: 'remote' | 'local';
}

/** Strategy-agnostic retriever. */
export interface SkillRetriever {
  retrieve(params: RetrieveParams): Promise<RetrievedSkill[]>;
}

/** Minimal SQL executor port — the api wires a pg-pool-backed implementation. */
export interface QueryExecutor {
  query<T>(sql: string, params: readonly unknown[]): Promise<T[]>;
}

/** Typed retriever error (never leaks secrets). */
export class RetrieverError extends Error {
  override readonly cause: unknown;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(message: string, cause: unknown = null, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RetrieverError';
    this.cause = cause;
    this.context = context;
  }
}
