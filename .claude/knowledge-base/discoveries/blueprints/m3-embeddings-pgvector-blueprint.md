---
slug: m3-embeddings-pgvector
milestone_id: M3
created_at: 2026-06-23
generated_by: discover-execute
sources:
  - theo-rag (sibling): packages/core/src/domain/embedders/* (port + stub + openai), providers/embedder-selection.ts, schema vector(1536) + HNSW
  - knowledge-base/references/semantic-router (intent routing via embeddings)
  - knowledge-base/references/openskills (skill metadata shape)
---

# Blueprint: M3 — Embeddings plugáveis + indexação (pgvector)

## Problem

Pós-M2 o registry só encontra skills por correspondência exata de termo. Para habilitar busca por
intenção (north-star Recall@5 ≥ 0.85, base do M4) é preciso gerar e indexar embeddings vetoriais de
cada revisão de skill, com provider de embeddings plugável (DIP) e dimensão pinada com segurança.

## Prior art (how the house solves it — Rule 9)

theo-rag já tem o padrão validado e em produção (reusar, não reinventar):

- **Port `Embedder`** (`theo-rag/packages/core/src/domain/embedders/types.ts:34`): `embed(text, opts?) → Promise<number[]>`, `embedBatch(texts) → Promise<number[][]>`, `provider`, `model`, `dispose?`.
- **Adapters**: `createStubEmbedder` (SHA-256 seeded + L2-normalizado, determinístico, dim default 1536) e `createOpenAIEmbedder` (SDK openai v6, tiktoken truncation, backoff retry, matryoshka dims). `createLocalEmbedder` foi **deferido** na casa.
- **Selection** (`embedder-selection.ts`): `OPENAI_API_KEY` presente → openai; senão → stub. `DEFAULT_EMBEDDING_DIM = 1536`.
- **Schema**: customType `vector(1536)`, tabela `embeddings` com `unique(chunk_id, provider, model)` + índice **HNSW `vector_cosine_ops`**. Extensão via `CREATE EXTENSION IF NOT EXISTS vector` antes do `drizzle-kit push`.
- **Idempotência**: `INSERT ... ON CONFLICT (chunk_id, provider, model) DO NOTHING`.
- **Guard de dimensão**: no retrieval, `if (vec.length !== EMBEDDINGS_DIM) throw` — fail-fast.
- **Deps**: `pgvector@^0.2.1`, `openai@^6.41.0` (optional), `tiktoken@^1.0.22`.

## Decisões de escopo (locked — confirmadas pelo owner 2026-06-23)

1. **Trio de adapters = stub + openai, e `local` reusa o SDK openai com base URL configurável**
   (`OPENAI_BASE_URL`) — um único caminho de código de produção (openai-compatible). "local" não
   traz dependência de modelo nativo; aponta para um servidor openai-compatible local
   (vLLM/LM Studio/llamafile). Honra o trio do DoD sem workaround.
2. **Dimensão fixa 1536 + guard fail-fast.** Coluna `vector(1536)`, índice HNSW cosine. No boot e no
   embed worker, validar `vector.length === 1536`; rejeitar (fail-fast) se o provider divergir.
   Evita corrupção silenciosa (risco do ROADMAP "dimensão fixada cedo demais" mitigado pelo guard).

## Coverage Corner 1 — Integration Tests

- **Criar skill → embedding presente e consultável.** POST /v1/skills (stub provider) → poll operação ACTIVE → o worker de embed gera o vetor → `SELECT 1 - (vector <=> $q) AS score FROM embeddings WHERE revision_id = ...` retorna linha; ordenação por similaridade funciona.
- **Reindex idempotente.** PATCH com novo payload → nova revisão → novo embedding; re-execução do job (mesmo revision_id/provider/model) não duplica (ON CONFLICT DO NOTHING).
- **Troca de provider não toca o domínio.** Selecionar stub vs openai-compatible via env; o domínio (port) é idêntico; teste injeta o embedder explícito.
- **Guard de dimensão.** Um embedder que devolve dim ≠ 1536 faz o job falhar explicitamente (não grava vetor corrompido).
- **Geração assíncrona.** A criação da skill não bloqueia no embedding; o embed roda no worker pg-boss (job `embed_skill`), fora do caminho da resposta.

## Coverage Corner 2 — Dependencies

| Dep | Versão | Papel | Risco |
|---|---|---|---|
| `pgvector` | ^0.2.1 | encoding SQL `[a,b,c]` + helper toSql | baixo (maduro, usado na casa) |
| `openai` | ^6.41.0 (optional) | SDK de embeddings (prod + "local" via baseURL) | optionalDependency; ausente no CI (stub) |
| `tiktoken` | ^1.0.22 | truncation por tokens antes da API openai | WASM; sem binding nativo |
| `drizzle-orm` | ^0.45.0 (já presente) | customType `vector(1536)` | nenhum |

CVE audit obrigatório via `/deps-audit` antes do código.

## Coverage Corner 3 — Tools

- Drizzle customType para `vector(1536)` (mesmo padrão do `bytea` já no schema).
- pgvector extensão Postgres (container `theoskill_pgvector` já tem pgvector — imagem `pgvector`).
- HNSW index (`USING hnsw (vector vector_cosine_ops)`) — recall/latência melhores que ivfflat.
- pg-boss job novo `embed_skill` (reusa a infra de fila/worker do M0-M2).

## Coverage Corner 4 — Techniques

- **DIP**: port `EmbeddingProvider` no core/domain; adapters no core/domain/embedders (stub) e api/server/providers (selection). O domínio depende só do port.
- **Async no worker**: o handler de create/update enfileira `embed_skill {revision_id, skill_id}`; o worker gera + grava. Custo/latência do modelo fora do caminho da LRO (risco ROADMAP mitigado).
- **Idempotência**: `unique(revision_id, provider, model)` + `ON CONFLICT DO NOTHING`. Reindex seguro sob retry.
- **Guard fail-fast**: dimensão validada no boot (provider selecionado) e por embedding gerado.
- **Texto embeddado**: `name + "\n" + description + "\n" + corpo SKILL.md`. O corpo (`validated.skillMd`) é capturado no ingest e persistido na revisão (coluna `skill_md`), evitando re-unzip no worker.

## ADRs

### ADR D1 — `local` = openai SDK com base URL configurável
**Contexto**: o DoD pede trio openai/local/stub; a casa deferiu `local`.
**Decisão**: `local` não é um adapter separado com dep de modelo; é o adapter openai apontando para
`OPENAI_BASE_URL` (servidor openai-compatible local). Um caminho de código, zero dep pesada.
**Alternativas rejeitadas**: (a) adapter HTTP Ollama/TEI próprio — mais código, formato de resposta
divergente; (b) modelo onnx/transformers.js embarcado — dep pesada, fora do KISS/YAGNI.
**Consequência**: o nome "local" denota deployment, não um cliente distinto. Documentado.

### ADR D2 — Dimensão fixa 1536 + guard fail-fast
**Contexto**: ROADMAP alerta "dimensão fixada cedo demais".
**Decisão**: coluna `vector(1536)` (padrão da casa / text-embedding-3-small); guard rejeita provider
que emita dim ≠ 1536, no boot e por embedding.
**Alternativas rejeitadas**: dimensão por env dirigindo a migration — acopla a migration ao valor do
momento, adiciona complexidade sem caso concreto de 2º valor (YAGNI).
**Consequência**: trocar de dimensão futuramente exige migration explícita + ADR — aceitável.

### ADR D3 — Embedding por revisão, gerado assíncrono no worker
**Contexto**: embedding tem custo/latência; revisões são imutáveis.
**Decisão**: 1 embedding por (revision, provider, model); gerado por job `embed_skill` no worker
após a revisão existir. A skill aponta para a revisão corrente; a busca (M4) usa o embedding da
revisão corrente.
**Consequência**: a skill fica brevemente sem embedding entre a criação e o processamento do job
(eventual consistency) — aceitável; o estado da operação já é ACTIVE (a skill existe).

## Smells / riscos residuais

- **OpenAI custo/latência** — mitigado: assíncrono + stub no CI + tiktoken truncation.
- **Embedding órfão / perdido** — se o job `embed_skill` falhar todas as retries, a skill fica sem
  vetor. M3 garante retry com backoff; um reconciler de embeddings é possível mas é YAGNI agora
  (a skill ainda é recuperável: re-PATCH regenera). Documentar como follow-up.
- **Texto vazio** — skill sem description + body mínimo → embedding de string curta; aceitável.

## Verdict

SHIPPABLE_WITH_CAVEATS — padrão validado na casa, escopo travado pelo owner, riscos mapeados e
mitigados. Pronto para `/to-plan`.
