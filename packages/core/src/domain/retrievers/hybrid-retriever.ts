import { type RetrievedSkill, type RetrieveParams, type SkillRetriever } from './types.js';

/** Reciprocal Rank Fusion constant (standard k=60; calibration-free — no weights). */
export const RRF_K = 60;

/**
 * Candidate pool fetched from EACH sub-retriever before fusion. Decoupled from
 * (and ≥) the final topK so a skill ranked mid-list in BOTH lexical + vector lists
 * can still fuse high — the classic RRF-with-truncation pitfall. We fuse over the
 * deeper pool, then slice to topK.
 */
export const FUSION_POOL = 50;

export interface HybridRetrieverDeps {
  readonly vector: SkillRetriever;
  readonly keyword: SkillRetriever;
}

/**
 * Fuse two ranked lists by Reciprocal Rank Fusion: each list contributes
 * `1 / (k + rank)` per skill; a skill present in BOTH lists sums both terms.
 * Calibration-free (no lexical/vector weights to tune). Deterministic regardless
 * of which retriever resolves first.
 */
export function rrfFuse(
  vectorResults: readonly RetrievedSkill[],
  keywordResults: readonly RetrievedSkill[],
  topK: number,
): RetrievedSkill[] {
  const fused = new Map<string, { skill: RetrievedSkill; score: number }>();
  const accumulate = (list: readonly RetrievedSkill[]): void => {
    for (let rank = 0; rank < list.length; rank++) {
      const skill = list[rank]!;
      const term = 1 / (RRF_K + rank);
      const existing = fused.get(skill.skill_id);
      if (existing !== undefined) {
        existing.score += term;
        // MESCLA, não descarta. Os dois lados projetam colunas diferentes: `execution` e
        // `category` vinham só do keyword, e como o vetor é acumulado primeiro a linha dele
        // — sem os campos — vencia. Para toda skill presente nas DUAS listas (o caso comum)
        // os campos sumiam do resultado, e o cliente trata ausente como permitido. Nada
        // errava: a resposta era plausível e incompleta.
        //
        // Preenche só o que falta, campo a campo e por nome: o que já veio da lista de
        // maior precedência fica. Enumerar os campos em vez de varrer o objeto mantém a
        // mescla visível — um campo novo no contrato aparece aqui como decisão, não é
        // copiado por acidente.
        existing.skill = {
          ...existing.skill,
          ...(existing.skill.execution === undefined && skill.execution !== undefined
            ? { execution: skill.execution }
            : {}),
          ...(existing.skill.category === undefined && skill.category !== undefined
            ? { category: skill.category }
            : {}),
        };
      } else {
        fused.set(skill.skill_id, { skill: { ...skill }, score: term });
      }
    }
  };
  accumulate(vectorResults);
  accumulate(keywordResults);
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score || a.skill.skill_id.localeCompare(b.skill.skill_id))
    .slice(0, topK)
    .map(({ skill, score }) => ({ ...skill, score }));
}

/**
 * Hybrid retriever — runs vector + keyword in PARALLEL over a deep candidate pool
 * and fuses via RRF. EITHER side degrades gracefully: a failure on the vector side
 * (e.g. embedder timeout) or the keyword side (e.g. missing FTS) yields an empty
 * list rather than failing the whole retrieve, so hybrid still answers from the
 * surviving retriever. (Single-strategy retrieve does NOT swallow errors — only
 * the fused hybrid path is resilient by design.)
 */
export function createHybridRetriever(deps: HybridRetrieverDeps): SkillRetriever {
  return {
    async retrieve(params: RetrieveParams): Promise<RetrievedSkill[]> {
      const poolParams: RetrieveParams = {
        query: params.query,
        topK: Math.max(params.topK, FUSION_POOL),
        // O filtro tem de atravessar para as DUAS pernas. Sem isto a estratégia PADRÃO
        // (`hybrid`) o descartava, e só a `keyword` — inalcançável pela rota — o honrava.
        ...(params.category !== undefined ? { category: params.category } : {}),
      };
      const [vectorResults, keywordResults] = await Promise.all([
        deps.vector.retrieve(poolParams).catch((): RetrievedSkill[] => []),
        deps.keyword.retrieve(poolParams).catch((): RetrievedSkill[] => []),
      ]);
      return rrfFuse(vectorResults, keywordResults, params.topK);
    },
  };
}
