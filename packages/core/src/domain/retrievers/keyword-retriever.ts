import { buildLifecycleClause } from './lifecycle-clause.js';
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
      // O filtro por categoria é parametrizado, nunca interpolado: `category` é texto
      // LIVRE vindo de quem publica e repassado por quem busca — concatená-lo no SQL seria
      // injeção pela porta da frente.
      const categoryClause = params.category !== undefined ? ` AND s.category = ${b.bind(params.category)}` : '';
      // M32 — o ciclo de vida entra AQUI, no caminho de descoberta, e em lugar nenhum do
      // caminho de resolução. Um helper único monta a cláusula (ADR D3).
      const lifecycleClause = buildLifecycleClause(b, params.lifecycle);
      const tsQuery = `to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', ${queryPh})), ' | '))`;
      // UNIÃO `minhas + públicas` (M14 DoD #2), e nada mais.
      //
      // A cláusula é `workspace_id = $ws OR visibility = 'public'` — repare no que ELA NÃO
      // permite: uma skill `private` de outro workspace não satisfaz nenhum dos dois lados,
      // e `shared` também não (organização é escopo que ainda não existe no dado). O
      // resultado declara a ORIGEM de cada linha, porque sem isso o consumidor não sabe se
      // está prestes a instalar código do próprio time ou de um terceiro.
      const sql = `
        SELECT s.skill_id, s.name, s.description, ts_rank(s.search_tsv, ${tsQuery}) AS score,
               CASE WHEN s.workspace_id = ${wsPh} THEN 'own' ELSE 'public' END AS origin,
               s.category, s.execution
        FROM skills s
        WHERE (s.workspace_id = ${wsPh} OR s.visibility = 'public')
          AND s.deleted_at IS NULL AND s.search_tsv @@ ${tsQuery}${categoryClause}${lifecycleClause}
        ORDER BY score DESC, s.skill_id ASC
        LIMIT ${limitPh}
      `;
      return runRetrieveQuery(deps.executor, sql, b.getParams());
    },
  };
}
