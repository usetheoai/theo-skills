---
slug: m3-embeddings-pgvector
milestone_id: M3
plan: knowledge-base/plans/m3-embeddings-pgvector-plan.md
completed_at: 2026-06-23
verdict: IMPLEMENTATION_COMPLETE
---

# M3 — Embeddings plugáveis + indexação (pgvector) — Implementation Summary

4 fases TDD. Estado final: typecheck PASS, lint 0/0, 121 testes verdes
(core 29 + api contract 40 + integração 52). Plan-confidence SHIPPABLE (91.2). deps-audit: 0 CVEs.

## Phase 1 — Embedder port + adapters (commit e2111c2)

- `core/domain/embedders/types.ts` — port `EmbeddingProvider` (DIP): `embed`/`embedBatch`/`provider`/
  `model`; `EMBEDDING_DIM=1536`; `EmbedderError`; `assertEmbeddingDim` (guard fail-fast).
- `stub-embedder.ts` — determinístico (SHA-256 seeded + L2-normalizado), offline (adaptado do theo-rag, Rule 9).
- `openai-embedder.ts` — SDK openai v6 com cliente injetável, `baseURL` configurável (= "local", ADR D1),
  backoff em erro transitório; import lazy (optionalDependency).
- Wiring: caller = exportado no barrel do core; tests unitários (11); métrica = N/A (puro).

## Phase 2 — Schema pgvector (commit 8c9c0fa)

- customType `vector(1536)`; tabela `embeddings` (por revisão; FK cascade; unique
  `(revision_id, provider, model)`; índice HNSW `vector_cosine_ops`); coluna `skill_revisions.skill_md`.
- Migration 0004 com `CREATE EXTENSION IF NOT EXISTS vector` prepended; aplicada.
- `skill_md` threadado: ingest → job data (`skill_md`) → worker → store → coluna.

## Phase 3 — Selection + embed worker + enqueue (commit b227f92)

- `providers/embedder-selection.ts` — env (`OPENAI_API_KEY`→openai com `OPENAI_BASE_URL`; senão stub);
  injeção explícita vence (seam). Guard de dimensão no boot (`server.ts`).
- `store/embeddings-store.ts` — `getEmbedSourceBySkill` (join skills+revisão corrente), `upsert`
  (ON CONFLICT DO NOTHING), `listByRevision`; tipos de domínio no boundary.
- `embed/embed-worker.ts` — `createEmbedSkillHandler` (resolve fonte → embed → `assertEmbeddingDim` →
  upsert); `createEmbedEnqueuer` (onTerminal ACTIVE de create/update; `singletonKey` dedup);
  `registerEmbedWorker`.
- `worker.ts` — `composeTerminalHooks` compõe webhook + embed enqueuers.
- `server.ts` — queue EMBED_SKILL + embedder selecionado/validado no boot + embed worker registrado.

### Wiring triad
- Caller: `createEmbedEnqueuer` (onTerminal) → `embed_skill` job → `createEmbedSkillHandler`.
- Integration test: embed-worker (5) + selection (3).
- Runtime metric: log `skill embedded` com skill_id/revision_id/provider; log `embedder selected` no boot.

## Phase 4 — E2E (commit b227f92)

- `m3-embeddings-e2e.integration.test.ts` — criar skill → poll ACTIVE → embedding presente e
  consultável por cosine (top hit); troca de provider (port idêntico, embedder injetado distinto →
  provider/model gravados). Workers registrados 1× com embedder-proxy mutável (evita workers duplicados).

## Decisões

- `local` = adapter openai com `OPENAI_BASE_URL` (ADR D1) — um caminho de código.
- Dimensão fixa 1536 + guard fail-fast (ADR D2) — boot + por embedding; sem corrupção silenciosa.
- Embedding da **revisão corrente** (worker resolve `latest_revision_id`); job carrega só `skill_id` →
  updates rápidos colapsam via singletonKey; revisão final é a indexada (ADR D3).
- Geração assíncrona no worker (custo/latência fora do caminho da LRO).
- Deps: `pgvector`, `tiktoken` (deps), `openai` (optionalDependency) — 0 CVEs.
