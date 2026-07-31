import { type QueryExecutor, type RetrievedSkill, RetrieverError } from './types.js';

interface Row {
  skill_id: string;
  name: string;
  description: string;
  score: number | string;
  /** `own` | `public` (M14) — ausente nos retrievers que ainda não a projetam. */
  origin?: string;
}

/**
 * Run a retriever SQL and map rows to RetrievedSkill, coercing the pg numeric
 * `score` (returned as a string by node-pg) to a number. Executor failures are
 * wrapped in `RetrieverError` so a raw pg/driver error (which may carry the SQL
 * or connection detail) never leaks to the caller.
 */
export async function runRetrieveQuery(
  executor: QueryExecutor,
  sql: string,
  params: readonly unknown[],
): Promise<RetrievedSkill[]> {
  let rows: Row[];
  try {
    rows = await executor.query<Row>(sql, params);
  } catch (err) {
    throw new RetrieverError('retrieve query failed', err, {});
  }
  return rows.map((r) => ({
    skill_id: r.skill_id,
    name: r.name,
    description: r.description,
    // A origem só entra quando a consulta a projeta — o híbrido combina resultados de dois
    // retrievers, e forçar um default aqui inventaria procedência para uma linha que não a
    // declarou.
    ...(r.origin === 'own' || r.origin === 'public' ? { origin: r.origin } : {}),
    score: Number(r.score),
  }));
}
