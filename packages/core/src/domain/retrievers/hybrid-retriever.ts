import { type MatchedLeg, type RetrievedSkill, type RetrieveParams, type SkillRetriever } from './types.js';

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
  /**
   * Avisa que uma das pernas caiu — e por quê.
   *
   * Sem isto o `.catch(() => [])` abaixo transformava a falha em lista vazia e a busca
   * respondia 200 com resultado só lexical. Medido em produção 2026-08-01: a conta do
   * provedor de embedding ficou sem crédito, a descoberta semântica — a promessa central do
   * produto — parou, e nada acusou: `/v1/health` seguia `ok`.
   *
   * Resiliência sem observabilidade é o defeito, não a solução: quem resolve não fica
   * sabendo, e quem consome não sabe que recebeu menos.
   */
  readonly onDegraded?: (perna: 'vector' | 'keyword', err: unknown) => void;
  /**
   * Teto de tempo por perna, em ms. Ausente = espera (quem não pediu limite não ganha um).
   *
   * Medido em produção 2026-08-01: com a conta do provedor de embedding sem crédito, a perna
   * vetorial levava 9,4 s e a busca inteira ia junto. Detectar o formato do erro do
   * fornecedor é frágil — `code` mudou entre versões e a mensagem é texto livre. O teto não
   * depende de adivinhar nada: seja qual for a causa, a descoberta não pode gastar o
   * orçamento de latência do agente esperando uma metade que não responde.
   */
  readonly timeoutMs?: number;
}

/** Erro do teto — distinguível de uma falha da própria perna no log de degradação. */
export class RetrieverTimeoutError extends Error {
  constructor(perna: string, ms: number) {
    super(`perna '${perna}' excedeu ${String(ms)}ms`);
    this.name = 'RetrieverTimeoutError';
  }
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
  const fused = new Map<
    string,
    { skill: RetrievedSkill; score: number; matched: MatchedLeg[] }
  >();
  // `leg` é PARÂMETRO, não inferido: a função não tem como saber qual lista recebeu, e
  // adivinhar por ordem de chamada seria acoplar a atribuição à ordem do código — exatamente o
  // acidente que este campo existe para tornar visível.
  const accumulate = (list: readonly RetrievedSkill[], leg: MatchedLeg['leg']): void => {
    for (let rank = 0; rank < list.length; rank++) {
      const skill = list[rank]!;
      const term = 1 / (RRF_K + rank);
      // 1-based na saída; o laço segue 0-based porque a fórmula depende disso (o 1º colocado
      // tem de valer 1/RRF_K).
      const attribution: MatchedLeg = { leg, rank: rank + 1 };
      const existing = fused.get(skill.skill_id);
      if (existing !== undefined) {
        existing.score += term;
        existing.matched.push(attribution);
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
        fused.set(skill.skill_id, {
          skill: { ...skill },
          score: term,
          matched: [attribution],
        });
      }
    }
  };
  accumulate(vectorResults, 'vector');
  accumulate(keywordResults, 'keyword');
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score || a.skill.skill_id.localeCompare(b.skill.skill_id))
    .slice(0, topK)
    .map(({ skill, score, matched }) => ({ ...skill, score, matched }));
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
      const degradar = (perna: 'vector' | 'keyword') => (err: unknown): RetrievedSkill[] => {
        deps.onDegraded?.(perna, err);
        return [];
      };
      const comTeto = (perna: 'vector' | 'keyword', p: Promise<RetrievedSkill[]>): Promise<RetrievedSkill[]> => {
        if (deps.timeoutMs === undefined) return p;
        const ms = deps.timeoutMs;
        return Promise.race([
          p,
          new Promise<RetrievedSkill[]>((_, rej) => {
            const t = setTimeout(() => rej(new RetrieverTimeoutError(perna, ms)), ms);
            // `unref` para o teto não segurar o processo vivo — um timer pendente num
            // processo curto (CLI, teste) o faria terminar mais tarde sem razão visível.
            (t as unknown as { unref?: () => void }).unref?.();
          }),
        ]);
      };
      const [vectorResults, keywordResults] = await Promise.all([
        comTeto('vector', deps.vector.retrieve(poolParams)).catch(degradar('vector')),
        comTeto('keyword', deps.keyword.retrieve(poolParams)).catch(degradar('keyword')),
      ]);
      return rrfFuse(vectorResults, keywordResults, params.topK);
    },
  };
}
