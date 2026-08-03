# Review: m3-embeddings-pgvector

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 (architecture, tests, domain-embeddings/pgvector, cross-validation)
**Findings:** 0 BLOCKER, 2 HIGH (fixed), 8 MEDIUM (fixed/accepted), LOW/INFO
**Verdict:** READY_TO_MERGE

## Scope

M3 milestone diff `e2111c2^..HEAD`: EmbeddingProvider port (stub/openai, `local`=baseURL), pgvector
schema (vector(1536) + HNSW cosine), async embed worker, idempotent reindex, dimension guard.

## Findings + resolutions

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| F-dom-1 | HIGH | `singletonKey=skill_id` (30s) deduped an update's embed against the create's → new revision left unindexed (violated "reindex on update"). Exposed by the UPDATE E2E test. | **FIXED** — embed job now carries `revision_id`, captured at enqueue, singleton-keyed by it. Each revision embedded exactly once; updates never dedup against the prior revision. |
| F-dom-2 / F-xval-1 | HIGH/MED | `tiktoken` + `pgvector` declared but never imported; token truncation promised (T1.3) but absent. | **FIXED** — removed both unused deps; added char-based safety truncation (`maxInputChars`, ~7500 tokens) in the openai adapter (no dep). |
| F-arch-5 | MED | `EMBEDDING_DIM` (domain) vs `EMBEDDING_COLUMN_DIM` (schema) — two sources of truth, can drift. | **FIXED** — schema imports `EMBEDDING_DIM` from the domain (allowed infra→domain direction); one source of truth. |
| F-dom-4 | MED | Boot probe made a live OpenAI call → coupled HTTP-API liveness to OpenAI + cost per restart. | **FIXED** — boot probe runs ONLY for the stub; openai relies on the per-embedding guard (no crashloop on OpenAI outage). |
| F-dom-5 | MED | No dead-letter for `embed_skill` → a permanently-failing embed dropped silently. | **FIXED** — `embed_skill_dlq` + handler logs `skill has no embedding` (observable; recoverable via re-PATCH). |
| F-test-1 | HIGH | OpenAI AbortSignal passthrough + AbortError-no-retry untested. | **FIXED** — unit tests (signal threaded; abort → 1 call, no retry). |
| F-test-2 / F-xval-2 | HIGH/MED | "local = baseURL" path untested. | **FIXED** — `clientFactory` seam + test asserts `{apiKey, baseURL}` reaches the SDK ctor. |
| F-test-3 / F-xval-3 | HIGH/LOW | UPDATE→new-revision→new-embedding untested. | **FIXED** — E2E asserts a 2nd embedding row for the new revision. |
| F-test-4 | MED | Single-skill cosine query trivially true. | **FIXED** — multi-skill ranking test (matching skill ranks first among 3). |
| F-test-5 | MED | Enqueuer semantics (delete/FAILED skip; singletonKey) untested. | **FIXED** — unit tests for ACTIVE create/update enqueue, delete/FAILED/no-revision skip, key=revisionId. |
| F-test-8 | INFO | Retry exhaustion / 429 / 400 untested. | **FIXED** — tests for 429 retry, 5xx exhaustion, 400 fast-fail. |
| F-dom-3 | MED | `fromDriver` (JSON.parse) read-path untested; NaN throws. | **PARTIAL/ACCEPTED** — round-trip test added (Drizzle SELECT → fromDriver). NaN: stub L2-normalizes, openai never emits NaN — acceptable; documented. |
| F-arch-4 | LOW | `getEmbedSource*` join in embeddings-store (mild SRP). | **ACCEPTED** — purpose-built read-model, single consumer; extract if a 2nd appears (YAGNI). |
| F-test-6 | LOW | Boot guard glue untested. | **ACCEPTED** — now stub-only thin glue; `assertEmbeddingDim` unit-tested. |
| F-arch-1/2/3/6/7/8/9, F-dom-6/7/8/9, F-test-7 | INFO | Positive confirmations: clean DIP port, correct optionalDependency boundary, correct ON CONFLICT target, HNSW cosine correct, migration ordering correct, deterministic tests. | — |

## Cross-validation summary

Per-task T1.1–T4.2 fully implemented. Wiring triad present + production-composed (embed enqueuer
fired as onTerminal via `composeTerminalHooks`; embed worker + DLQ registered; metrics logged). All
three ROADMAP DoD items met; `local`=openai+baseURL honestly documented (ADR D1, owner-confirmed).

## Quality gates

- typecheck PASS · lint 0/0 · code-quality PASS (cap 100, 0 caps)
- 134 tests green: core 35 + api contract 45 + integration 54
- deps-audit: 0 CVEs (and 2 unused deps removed during hardening)
- Zero new runtime dependencies beyond `openai` (optionalDependency)

## Handoff decision

**READY_TO_MERGE.** No BLOCKER. The one real correctness defect (F-dom-1, dedup-skips-revision) was
caught by the milestone's own UPDATE test and fixed (revision-keyed embedding). All HIGH/MEDIUM
findings are fixed or accepted with documented rationale. Proceed to `/release` for v0.4.0 (minor —
`Added`, no breaking changes).
