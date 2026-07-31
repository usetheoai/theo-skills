import { assertEmbeddingDim, type EmbeddingProvider } from '../embedders/index.js';

import { runRetrieveQuery } from './map-row.js';
import { ParamBuilder } from './param-builder.js';
import { type QueryExecutor, type RetrievedSkill, type RetrieveParams, type SkillRetriever } from './types.js';

export interface VectorRetrieverDeps {
  readonly executor: QueryExecutor;
  readonly embedder: EmbeddingProvider;
  /** Workspace fixado na construção — ver `KeywordRetrieverDeps.workspaceId`. */
  readonly workspaceId: string;
}

/**
 * Vector retriever — embeds the query, then ranks each skill's CURRENT-revision
 * embedding by cosine similarity (`1 - (vector <=> q)`). Dimension is guarded
 * BEFORE the SQL so a mismatched provider never leaks an opaque pg error.
 */
export function createVectorRetriever(deps: VectorRetrieverDeps): SkillRetriever {
  return {
    async retrieve(params: RetrieveParams): Promise<RetrievedSkill[]> {
      const vec = await deps.embedder.embed(params.query);
      assertEmbeddingDim(vec);
      const b = new ParamBuilder();
      const vecPh = b.bind(`[${vec.join(',')}]`);
      const wsPh = b.bind(deps.workspaceId);
      const limitPh = b.bind(params.topK);
      // O JOIN carrega `workspace_id` por NECESSIDADE, não por simetria: desde que a PK
      // de `skills` virou composta `(workspace_id, skill_id)`, o `skill_id` deixou de ser
      // único globalmente. Juntar só por `skill_id` casaria a skill de um tenant com o
      // embedding de outro que escolheu o mesmo id — um vazamento silencioso que nenhum
      // filtro no WHERE corrigiria, porque a linha errada já teria entrado no resultado.
      const sql = `
        SELECT s.skill_id, s.name, s.description, 1 - (e.vector <=> ${vecPh}::vector) AS score
        FROM embeddings e
        JOIN skills s
          ON s.workspace_id = e.workspace_id
         AND s.skill_id = e.skill_id
         AND e.revision_id = s.latest_revision_id
        WHERE s.workspace_id = ${wsPh} AND s.deleted_at IS NULL
        ORDER BY e.vector <=> ${vecPh}::vector ASC, s.skill_id ASC
        LIMIT ${limitPh}
      `;
      return runRetrieveQuery(deps.executor, sql, b.getParams());
    },
  };
}
