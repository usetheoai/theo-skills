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
      // O ESPAÇO VETORIAL É PARTE DA CHAVE DE BUSCA.
      //
      // A consulta foi embutida pelo provider ATIVO; comparar o vetor resultante com um
      // gravado por outro modelo não é aproximação ruim, é operação sem significado — as
      // dimensões não representam as mesmas coisas.
      //
      // O upsert é chaveado por `(revisão, provider, model)`, então trocar de provider NÃO
      // substitui o vetor antigo: ele fica na tabela. Sem este filtro a mesma skill entra
      // duas vezes na busca, e a linha sem sentido pode ganhar da certa com um score que
      // parece legítimo. Medido ao ligar o provider real: as linhas de `stub` permaneceram.
      const providerPh = b.bind(deps.embedder.provider);
      const modelPh = b.bind(deps.embedder.model);
      const limitPh = b.bind(params.topK);
      // O JOIN carrega `workspace_id` por NECESSIDADE, não por simetria: desde que a PK
      // de `skills` virou composta `(workspace_id, skill_id)`, o `skill_id` deixou de ser
      // único globalmente. Juntar só por `skill_id` casaria a skill de um tenant com o
      // embedding de outro que escolheu o mesmo id — um vazamento silencioso que nenhum
      // filtro no WHERE corrigiria, porque a linha errada já teria entrado no resultado.
      // Mesmo formato do keyword-retriever: PARAMETRIZADO, nunca interpolado. `category` é
      // texto livre vindo do frontmatter de um terceiro — concatená-lo no SQL seria injeção.
      //
      // Sem esta cláusula o filtro era MEIO-aplicado: só a perna de palavra-chave filtrava, e
      // na estratégia PADRÃO (`hybrid`) a perna vetorial devolvia skills fora da categoria que
      // a fusão então mantinha. O agente pedia uma categoria e recebia outra, sem erro —
      // resultado plausível, o modo mais caro de errar.
      const categoryClause = params.category !== undefined ? ` AND s.category = ${b.bind(params.category)}` : '';
      const sql = `
        SELECT s.skill_id, s.name, s.description, 1 - (e.vector <=> ${vecPh}::vector) AS score,
               s.category, s.execution,
               CASE WHEN s.workspace_id = ${wsPh} THEN 'own' ELSE 'public' END AS origin
        FROM embeddings e
        JOIN skills s
          ON s.workspace_id = e.workspace_id
         AND s.skill_id = e.skill_id
         AND e.revision_id = s.latest_revision_id
         AND e.provider = ${providerPh}
         AND e.model = ${modelPh}
        WHERE (s.workspace_id = ${wsPh} OR s.visibility = 'public') AND s.deleted_at IS NULL${categoryClause}
        ORDER BY e.vector <=> ${vecPh}::vector ASC, s.skill_id ASC
        LIMIT ${limitPh}
      `;
      return runRetrieveQuery(deps.executor, sql, b.getParams());
    },
  };
}
