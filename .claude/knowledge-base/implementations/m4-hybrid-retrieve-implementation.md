---
slug: m4-hybrid-retrieve
milestone_id: M4
plan: knowledge-base/plans/m4-hybrid-retrieve-plan.md
completed_at: 2026-06-23
verdict: IMPLEMENTATION_COMPLETE
---

# M4 — Busca híbrida transparente (RetrieveSkills) — Implementation Summary

4 fases TDD. Estado final: typecheck PASS, lint 0/0, 163 testes verdes (core 47 + api contract 46 +
integração 70). Plan-confidence SHIPPABLE (100). ZERO dependências novas.

## Phase 1 — FTS schema (commit eef39f9)

- `skills.search_text` (name + description + corpo SKILL.md corrente) + `search_tsv` (tsvector
  `english` gerado) + índice GIN. Migration 0005.
- `skills-store.refreshSearchText` mantém `search_text` sincronamente nas 3 vias de escrita
  (createWithRevision/addRevision/updateMetadata) — sempre-corrente, inclusive em PATCH de metadados.

## Phase 2 — Retriever port + adapters (commit 26f0998)

- `core/domain/retrievers`: porta `SkillRetriever` (DIP) + `QueryExecutor` + `ParamBuilder` (`$N` seguro).
- `vector-retriever` (cosine pgvector da revisão corrente, `assertEmbeddingDim` antes do SQL).
- `keyword-retriever` (FTS por lexemas OR-ados: `to_tsquery(array_to_string(tsvector_to_array(to_tsvector(q)),'|'))`
  — recall-friendly E seguro contra input livre).
- `hybrid-retriever` (RRF k=60 calibration-free; `Promise.all`; keyword degrada via `.catch`).

## Phase 3 — Contrato + dispatcher + endpoint + métrica (commit aba51ff)

- Contrato: `RetrieveParamsSchema` (query, top_k=5, strategy=hybrid) + `RetrieveResultSchema` (score).
- `retriever-selection.createDispatchingRetriever` roteia por strategy.
- `pg-executor` (port `QueryExecutor` sobre pg Pool).
- `handlers/retrieve.GET /v1/skills:retrieve` — parse query params → retriever → `{results:[{skill_id,score,...}], trace_id}`; 400 em query vazia.
- Métrica `retrieve` (latency_ms + top_score + result_count) — north-star observável.

## Phase 4 — Eval + benchmark + E2E (commit 4fcfb4e)

- `eval/dataset.json` (13 skills + 13 queries) + `eval/run-recall.ts` (seed + Recall@5 + p95).
- `m4-recall.integration.test.ts`: **Recall@5 = 1.0 ≥ 0.85**; **p95 < 200ms** contra Postgres real.
- `m4-retrieve-e2e.integration.test.ts`: POST → embed assíncrono → retrieve híbrido com a skill
  relevante no topo + score; estratégias vector/keyword/hybrid ponta-a-ponta.

### Wiring triad
- Caller: `app.ts` registra a rota retrieve com o dispatcher (pg-executor + embedder selecionado).
- Integration test: retrievers (4) + endpoint (4) + recall (2) + E2E (2) + FTS schema (4).
- Runtime metric: log `retrieve` (latency_ms/top_score).

## Decisões

- **Keyword = OR de lexemas** (não `websearch_to_tsquery` AND): para *recall*, uma skill que casa
  QUALQUER termo é candidata (ranqueada por ts_rank). O AND quebrava a conjunção com palavras fora do
  alvo (ex.: "long"/"get"). Seguro: os lexemas são tokens limpos — nenhum operador do usuário chega
  ao `to_tsquery` (ADR-aprimorado vs theo-rag).
- **RRF k=60** calibration-free (sem pesos a tunar) — mitiga o risco "fusão mal calibrada".
- **FTS síncrono** em `skills.search_text` (ADR D2) — consistente em PATCH de metadados.
- **Eval honesto** (ADR D3): medido com stub embedder; recall pelo FTS lexical; OpenAI adiciona
  semântico em produção. `name` do frontmatter é slug (`^[a-z0-9-]+$`); recall vem de description+body+slug.
- ZERO deps novas — FTS nativo do Postgres + pgvector (M3) + fusão RRF (~30 linhas) (Rule 9).

## "Fusão/rerank" do DoD — esclarecimento honesto (Rule 3)

O DoD do M4 diz "fusão/rerank". Entregamos **RRF**, que FUNDE as duas listas E **reordena** o
conjunto fundido por `Σ 1/(k+rank)` (fusão + reranking em um passo, calibration-free). Um reranker
dedicado de 2º estágio (cross-encoder) NÃO foi implementado — é deferido (YAGNI): o eval atinge
Recall@5 ≥ 0.85 sem ele, e um cross-encoder traria dep pesada + latência. Documentado como decisão
consciente, não omissão. Se um caso futuro exigir, entra como follow-up via ADR.

## Pós-review (hardening — 4 agentes especialistas, 0 BLOCKERs)

- **Pool de fusão profundo** (F-dom-3): `FUSION_POOL=50` desacopla o candidato-pool do topK — uma
  skill mid-rank em ambas as listas pode fundir alto (fecha a limitação RRF-com-truncamento).
- **Degradação graciosa de ambos os lados** (F-xval-5): hybrid faz `.catch` no vector E no keyword —
  embedder fora do ar → keyword-only; FTS fora → vector-only. Single-strategy NÃO mascara erro.
- **`RetrieverError` wired** (F-xval-3): `runRetrieveQuery` encapsula falhas do executor (não vaza
  erro pg/SQL); também resolve o DRY do mapeamento de linhas (F-arch-7).
- **CHANGELOG corrigido** (F-xval-1): descreve a query OR-lexema real (não `websearch_to_tsquery`).
- **Eval honesto** (F-test-1/2/3): gate é `Recall@5 ≥ 0.85` (DoD, sem `toEqual([])` decorativo);
  teste de **vector-only recall < 0.5** torna VISÍVEL que a perna vetorial é inerte sob stub (FTS
  carrega o recall); caveat de escala do p95 documentado.
- **Testes adicionados**: OR-recall (1 termo), all-stopword→[], dim-guard lança, executor-error→
  RetrieverError, tombstone-recycle search_text, scores exatos na degradação, order-independence,
  empty-input RRF. Total 172 testes.
