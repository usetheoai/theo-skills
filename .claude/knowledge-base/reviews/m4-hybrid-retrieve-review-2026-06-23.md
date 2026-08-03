# Review: m4-hybrid-retrieve

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 (architecture, tests, domain-retrieval/FTS/RRF, cross-validation)
**Findings:** 0 BLOCKER, 3 HIGH (fixed), MEDIUM (fixed/accepted), LOW/INFO
**Verdict:** READY_TO_MERGE

## Scope

M4 milestone diff `eef39f9^..HEAD`: hybrid skill retrieve — FTS lexical (`tsvector`+GIN) + pgvector
cosine fused via RRF (k=60), endpoint `GET /v1/skills:retrieve` with explicit `score`, eval set
(Recall@5 ≥ 0.85, p95 < 200ms), north-star metric.

## Findings + resolutions

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| F-xval-1 | HIGH | CHANGELOG overclaimed `websearch_to_tsquery`; code uses OR-lexeme `to_tsquery`. | **FIXED** — CHANGELOG now describes the real OR-lexeme strategy (Rule 6 honesty). |
| F-test-1 | HIGH | Stub vector leg is empirically noise → hybrid recall is FTS-only; dead leg invisible. | **FIXED** — added a vector-only recall test asserting < 0.5 (makes the dead leg VISIBLE); honesty `_note` already discloses it (Rule 3). |
| F-test-2 | HIGH | Recall@5 gate decorative at n=13 with `toEqual([])` (real gate was 1.0). | **FIXED** — dropped `toEqual([])`; the binding gate is now `recallAt5 ≥ 0.85` (the DoD), misses surfaced for debug. |
| F-dom-3 | MED | RRF candidate pool == topK → mid-rank cross-list skill can't surface (truncation pitfall). | **FIXED** — `FUSION_POOL=50` decouples the per-list pool from topK; fuse deep, slice topK. |
| F-xval-5 | MED | Plan claims vector-side graceful degradation; code only caught keyword. | **FIXED** — hybrid `.catch`es BOTH sides; embedder-down → keyword-only, FTS-down → vector-only; tested both. |
| F-xval-3 | MED | `RetrieverError` exported but never thrown (orphan export). | **FIXED** — `runRetrieveQuery` wraps executor failures in `RetrieverError` (no raw pg/SQL leak); also de-duplicates row mapping (F-arch-7). |
| F-xval-4 | MED | ROADMAP "fusão/rerank" — RRF fuses+reorders, but no dedicated reranker. | **DOCUMENTED** — RRF = fusion + reorder in one pass; cross-encoder reranker deferred (YAGNI; Recall@5 met without it). Honest ADR-style note in impl summary. |
| F-test-3 | MED | p95 benchmark not scale-meaningful at n=13. | **DOCUMENTED** — test comment states it's a smoke/regression guard, not a production SLO. |
| F-test-4 | MED | OR-lexeme single-term recall untested. | **FIXED** — test: query sharing only 1 term still matches. |
| F-test-5 | MED | Dimension guard at retriever level untested. | **FIXED** — wrong-dim embedder → retrieve rejects before SQL. |
| F-test-6 | MED | All-stopword query untested. | **FIXED** — empty-tsquery → `[]`, no throw (verified safe by domain reviewer against live pgvector). |
| F-dom-5 | MED | Tombstone-recycle search_text consistency (correct, but untested). | **FIXED** — regression test: recycle rebuilds search_text, no stale tokens. |
| F-test-7 | LOW | Degraded-path scores + "Concurrent" mislabel + empty-input. | **FIXED** — exact RRF scores on degraded path; real order-independence test; `rrfFuse([],[])` → []. |
| F-arch-2/7/8, F-dom-1/2/4/6/7/8/9/10, F-test-8/9 | LOW/INFO | SQL-in-domain (accepted behind QueryExecutor), positives (injection-safe, empty-tsquery safe, NULL-safe joins, bounded LIMITs, dim guard correct). | Accepted / positive confirmations. |

## Cross-validation summary

Per-task T1.1–T4.3 fully implemented. Wiring triad PASS (route registered in app.ts with real
executor+embedder; integration tests; `retrieve` metric). All 3 DoD items met: endpoint fuses
FTS+vector with `score` (DoD-1; "rerank"=RRF reorder, cross-encoder deferred); Recall@5 ≥ 0.85 +
p95 < 200ms measured/reproducible from a committed dataset (DoD-2); time-to-relevant-skill metric on
the path (DoD-3). Eval honesty disclosed (stub→FTS recall; OpenAI adds semantic).

## Quality gates

- typecheck PASS · lint 0/0 · code-quality PASS (cap 100, 0 caps)
- 172 tests green: core 50 + api contract 46 + integration 76
- deps-audit: ZERO new dependencies (FTS native + pgvector M3 + RRF ~30 LOC) — Rule 9
- Security: tsquery/SQL injection empirically refuted (to_tsvector round-trip strips operators; ParamBuilder binds)

## Handoff decision

**READY_TO_MERGE.** No BLOCKER. The HIGH findings (CHANGELOG accuracy + eval gate meaningfulness +
dead-vector-leg visibility) are fixed; the MEDIUMs are fixed or documented as conscious trade-offs
(rerank deferral, p95 scale caveat). Proceed to `/release` for v0.5.0 (minor — `Added`, no breaking).
