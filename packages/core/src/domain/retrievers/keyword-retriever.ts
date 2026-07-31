import { runRetrieveQuery } from './map-row.js';
import { ParamBuilder } from './param-builder.js';
import { type QueryExecutor, type RetrievedSkill, type RetrieveParams, type SkillRetriever } from './types.js';

export interface KeywordRetrieverDeps {
  readonly executor: QueryExecutor;
  /**
   * Workspace que este retriever enxerga. Obrigatório e fixado na CONSTRUÇÃO, não
   * passado por chamada: o mesmo desenho dos stores (`createSkillsStore(db, workspaceId)`),
   * em que o filtro é ESTRUTURAL e não disciplinar — não existe caminho de código que
   * construa um retriever sem tenant, então não existe consulta que esqueça o filtro.
   */
  readonly workspaceId: string;
}

/**
 * Keyword (lexical) retriever — Postgres FTS over `skills.search_tsv`, ranked by
 * `ts_rank`. The query is reduced to its stemmed lexemes and OR-ed together:
 * `to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', q)), ' | '))`.
 * This is RECALL-friendly (a skill matching ANY query term is a candidate, ranked
 * by ts_rank) and SAFE on raw user input — the lexemes are clean tokens, so no
 * user-supplied operator ever reaches `to_tsquery` (which would otherwise raise).
 */
export function createKeywordRetriever(deps: KeywordRetrieverDeps): SkillRetriever {
  return {
    async retrieve(params: RetrieveParams): Promise<RetrievedSkill[]> {
      const b = new ParamBuilder();
      const queryPh = b.bind(params.query);
      const wsPh = b.bind(deps.workspaceId);
      const limitPh = b.bind(params.topK);
      const tsQuery = `to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', ${queryPh})), ' | '))`;
      // `workspace_id` PRIMEIRO no WHERE — mesma convenção dos stores e do theo-memory:
      // o predicado mais seletivo à frente, e o isolamento visível na primeira linha
      // em vez de escondido no fim de uma cláusula longa.
      const sql = `
        SELECT s.skill_id, s.name, s.description, ts_rank(s.search_tsv, ${tsQuery}) AS score
        FROM skills s
        WHERE s.workspace_id = ${wsPh} AND s.deleted_at IS NULL AND s.search_tsv @@ ${tsQuery}
        ORDER BY score DESC, s.skill_id ASC
        LIMIT ${limitPh}
      `;
      return runRetrieveQuery(deps.executor, sql, b.getParams());
    },
  };
}
