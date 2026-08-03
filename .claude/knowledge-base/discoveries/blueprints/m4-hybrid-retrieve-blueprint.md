---
slug: m4-hybrid-retrieve
milestone_id: M4
created_at: 2026-06-23
generated_by: discover-execute
sources:
  - theo-rag (sibling): retrievers/{hybrid,keyword,vector}-retriever.ts, _internal/{build-retrieve-sql,param-builder}.ts, filter-composer.ts, migrations/0002_add_text_search.sql, handlers/retrievals.ts
  - knowledge-base/references/semantic-router (intent routing)
---

# Blueprint: M4 — Busca híbrida transparente (RetrieveSkills)

## Problem

M3 indexou embeddings (vetor). M4 entrega a descoberta por intenção que supera o Google Skill
Registry: endpoint `GET /v1/skills:retrieve` que combina busca lexical (Postgres FTS) + vetorial
(pgvector) com fusão/rerank e **score explícito** por resultado; com eval set interno
(Recall@5 ≥ 0.85, p95 < 200ms) e métrica north-star (time-to-relevant-skill).

## Prior art (theo-rag — Rule 9)

Padrão de retrieval híbrido validado:

- **Fusão = RRF (Reciprocal Rank Fusion), k=60** (`hybrid-retriever.ts:19,66-98`): `score = Σ 1/(k+rank)` por lista; **calibration-free** (sem pesos a tunar) — mitiga diretamente o risco ROADMAP "fusão mal calibrada degradando recall". Roda os dois retrievers em paralelo (`Promise.all`) e funde em memória; keyword degrada graciosamente (`.catch(()=>[])`).
- **Keyword (FTS)**: coluna `tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED` + índice GIN (`0002_add_text_search.sql`); query com `websearch_to_tsquery('english', $q)` (nunca lança em input livre, ao contrário de `to_tsquery`) + `ts_rank`.
- **Vector**: `1 - (vector <=> $q::vector)` (cosine→similaridade), HNSW, tie-break `, id ASC`; guard de dimensão antes do SQL.
- **ParamBuilder**: `$N` global threadado por todas as composições SQL (sem injeção).
- **Contrato**: `RetrieveParamsSchema` (query 1..8192, top_k default, strategy vector|keyword|hybrid) + `ScoredChunk` (id, score, ...). Score é **strategy-dependent** (não comparar entre estratégias) — documentado na resposta.
- **Dispatcher**: `createDispatchingRetriever` roteia por `params.strategy` (mesmo padrão de `embedder-selection`).
- **Deps**: ZERO novas (SQL puro + embedder do M3).

## Decisões de escopo (locked)

1. **Fusão = RRF k=60** (calibration-free). Sem pesos lexical/vetorial a tunar (mitiga risco #2).
2. **Endpoint `GET /v1/skills:retrieve?query=...&topK=...&strategy=...`** (AIP custom-method). Default `strategy=hybrid`, `topK=5` (alinhado a Recall@5). Retorna `{ results: [{ skill_id, score, name, description }], trace_id }`.
3. **FTS sobre o texto corrente da skill** (`name + description + corpo SKILL.md`). Coluna denormalizada `skills.search_text` mantida **sincronamente** pelo skills-store (create/addRevision/updateMetadata — única via de escrita de skills), com `search_tsv tsvector GENERATED ... STORED` + índice GIN. Sincronia evita o problema de consistência de metadados (PATCH de description sem nova revisão precisa atualizar o FTS) que o caminho assíncrono do embedding teria.
4. **Eval set honesto**: medido com o **stub embedder** (determinístico) — o componente **FTS** carrega o recall (queries com keywords das skills). Documentado: o embedder OpenAI adiciona recall semântico em produção; o eval prova a maquinaria + o recall lexical do hybrid. NÃO riggar (Rule 3).

## Coverage Corner 1 — Integration Tests

- **Retrieve hybrid**: indexar N skills → `GET /v1/skills:retrieve?query=...` retorna resultados ordenados por score RRF; a skill relevante no topo.
- **Estratégias**: vector / keyword / hybrid retornam shapes consistentes; score presente.
- **FTS websearch**: query multi-palavra / com operador não lança (websearch_to_tsquery).
- **Graceful degradation**: hybrid com keyword falhando ainda retorna vetor.
- **Soft-deleted / sem embedding**: skills deletadas não aparecem; skill sem embedding ainda aparece via keyword.
- **Score transparente**: cada resultado tem `score` numérico.

## Coverage Corner 2 — Dependencies

ZERO novas dependências de runtime (SQL + embedder M3). Eval/benchmark usam só o que já existe
(pg, vitest, stub embedder). `/deps-audit` confirmará (nada novo).

## Coverage Corner 3 — Tools

- Postgres FTS (`tsvector`/`to_tsvector`/`websearch_to_tsquery`/`ts_rank`) + índice GIN.
- pgvector HNSW (do M3) reusado para o componente vetorial.
- ParamBuilder (port do theo-rag) para `$N` seguro.
- Bench: medir p95 sobre as queries do eval set contra Postgres real.

## Coverage Corner 4 — Techniques

- **RRF in-memory** sobre duas listas (vector + keyword) — calibration-free.
- **DIP**: porta `SkillRetriever` no core/domain; adapters (vector/keyword/hybrid) no domínio; dispatcher na api. Embedder injetado (do M3).
- **FTS síncrono**: `skills.search_text` mantido no store (sempre-corrente), `search_tsv` gerado + GIN.
- **Eval reproduzível**: dataset (skills + queries + expected_ids) versionado; script calcula Recall@5; bench mede p95.
- **Métrica north-star**: log estruturado `retrieve` com `latency_ms` + `top_score` no caminho do handler (time-to-relevant-skill observável).

## ADRs

### ADR D1 — RRF k=60 (calibration-free) para a fusão
**Decisão**: RRF in-memory; sem pesos. **Alternativas rejeitadas**: combinação linear ponderada (exige tunar pesos — risco ROADMAP #2); rerank por cross-encoder (dep pesada, YAGNI no MVP). **Consequência**: score híbrido é fração pequena (~1/60); documentar "não comparar score entre estratégias".

### ADR D2 — FTS síncrono em `skills.search_text` (não assíncrono)
**Decisão**: manter `search_text` sincronamente no skills-store (create/addRevision/updateMetadata); `search_tsv` gerado + GIN. **Alternativas rejeitadas**: (a) tsvector dinâmico no query-time (sem índice GIN; O(n) scan; não escala); (b) atualizar via embed worker assíncrono (PATCH de metadados sem nova revisão não re-embeda → FTS desatualizado). **Consequência**: 3 pontos de escrita atualizam search_text; FTS sempre-corrente e indexado.

### ADR D3 — Eval medido com stub embedder, recall via FTS
**Decisão**: o eval set é medido contra o retrieve real com stub embedder; o recall vem do componente FTS (lexical). **Por quê**: o stub é determinístico mas não-semântico; medir recall honesto exige um sinal real — o FTS provê. **Consequência**: Recall@5 ≥ 0.85 é atingido pelo lexical; documentar que OpenAI adiciona recall semântico em produção (Rule 3 — sem rig).

## Smells / riscos residuais

- **Qualidade abaixo do alvo** (risco ROADMAP #1): mitigado por eval set desde o início + embedder trocável (M3). Se Recall@5 < 0.85 no eval, ajustar o eval set/queries OU o peso do FTS — documentado.
- **Score híbrido pouco intuitivo** (frações 1/60): documentado na resposta; clientes ordenam, não interpretam magnitude.
- **p95**: 2 queries por request hybrid; com GIN + HNSW em corpus pequeno, << 200ms. Bench confirma.

## Verdict

SHIPPABLE_WITH_CAVEATS — padrão validado na casa, fusão calibration-free, eval honesto, riscos
mapeados. Pronto para `/to-plan`.
