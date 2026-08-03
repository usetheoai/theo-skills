# Review: m9-close-gaps

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 (architecture, tests/wiring, cross-validation, security/robustness)
**Findings:** 0 BLOCKER, 0 HIGH (real defect), several MEDIUM/LOW — actionable ones FIXED, rest documented
**Verdict:** READY_TO_MERGE

## Scope

M9 diff `7fe7ba1..HEAD` (8 commits) closing the 7 cross-validation gaps vs ACE: trace_id propagation,
log scrubbing, explicit backoff, CLI init/config + read commands, test-marker taxonomy, embedder
provider seam. Plan: `knowledge-base/plans/m9-close-gaps-plan.md` (SHIPPABLE 97.6).

## Headline (independently verified by 4 agents)

All 7 gaps are **functionally implemented and wired** (caller + integration test + observable log per
the wiring triad). Architecture verdict: **SOUND** — trace-context/backoff/logger live in the
`api/server` infra layer with no leak into `core/domain`, no spurious new core port; the trace seam is
clean (OnOperationTerminal carries trace_id explicitly; the outbox/reconciler path persists it on the
delivery row — EC-1); the embedder registry is textbook OCP with the public `selectEmbedder` signature
preserved; CLI dispatch merges config at the composition root with flags-win semantics and proper
secret hygiene. Security verdict: **NO SECURITY BLOCKERS** — hostile `traceparent` can never reach logs
or DB (validated hex / generated), CLI auth is 0600 + never printed, `loadConfig` is crash-proof,
backoff is bounded.

## Findings + resolutions

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| F-test-1 | HIGH→fixed | gap #6 missing `test:fast` caller pillar (only the regex was pinned) | **FIXED** — root `test:fast` script (vitest `-t` fast-filter); verified it runs the filtered subset (57 tests). |
| F-test-2 | HIGH→fixed | lint emitted 2 `import/order` warnings vs the "0 warnings" DoD | **FIXED** — `eslint --fix`; `pnpm -r lint` exit 0, 0 warnings. |
| F-test-3/F-xval-1 | MED→fixed | EC-1 reconciler trace-preservation wired but **not asserted** | **FIXED** — `reconciler_reenqueue_preserves_trace_id` integration test: orphan delivery → reconciler re-enqueue → delivery-worker log carries the original trace_id. api integration 79→80. |
| F-xval-2 | MED→fixed | ADR-1 file not written (DoD required it in `knowledge-base/adrs/`) | **FIXED** — `adrs/0002-m9-trace-context-seam.md` with the M8-adoption contract. |
| F-arch-1/F-sec-1 | MED | Log scrubber is key-based + shallow (a secret nested in an object value, or embedded in an `err` string, would slip past) | **ACCEPTED (follow-up)** — the M9 DoD scoped scrubbing to known sensitive KEYS; all M9 call-sites log only scalars (`delivery_id`/`trace_id`/`status`/`err` message) so **no leak is introduced by this diff** (confirmed by the security agent). Recurse-one-level + value-pattern scrubbing tracked as a hardening follow-up. |
| F-arch-2 | LOW | `skills.ts` jobData spread after `trace_id` lets a caller-supplied `jobData.trace_id` override | **ACCEPTED** — no current caller passes one; cosmetic. |
| F-sec-2 | LOW | pre-M9 in-flight jobs lack `trace_id` → Drizzle default `''` (graceful, no crash) | **ACCEPTED** — drains within queue retention; `.notNull().default('')` is backfill-safe. |
| F-sec-3 | LOW | `writeConfig` 0600 not re-chmod'd on a pre-existing looser file | **ACCEPTED** — init normally creates the file; defense-in-depth follow-up. |
| F-test-4 | LOW | `computeBackoff` full-jitter is test-only (pg-boss applies exponential at runtime) | **ACCEPTED** — honest per ADR-2 (documented); the pure policy is the deliverable + M8/in-handler consumer. |
| F-xval-3 | INFO | code-quality verdict FAIL_SOFT | **ACCEPTED** — sole cap is `auditor_unavailable_knip` (the skill's `npx --yes knip` auditor can't run in this offline env — EC-25-class tooling gap). Manual `knip` run was performed and its 2 real M9 orphan-export findings (CONFIG_FILE, PROVIDER_REGISTRY) were FIXED (commit `ca77481`). Zero real dead-code/fabrication findings. |

## Cross-validation summary

7/7 ROADMAP DoD bullets + 10/10 plan tasks implemented. Edge-case MUST-FIX absorption: EC-1..EC-7 all
wired AND now tested (EC-1 closed this review). #7 delivered as the YAGNI seam per the DoD escape clause
(ADR-3). CHANGELOG updated with all M9 entries.

## Quality gates

- typecheck PASS · lint 0 errors / **0 warnings** · 
- **256 tests green**: 171 contract (core 56 + api 69 + cli 46) + 85 integration (api 80 + core 1 + cli 4)
- trace-propagation E2E (4): flows create→webhook, concurrent-distinct, malformed-header-generates, **reconciler-preserves-trace (EC-1)**
- `test:fast` selective runner works (57 filtered)
- deps-audit: **zero new runtime/dev deps** (ADR-1 no OTel SDK; backoff pure; config `node:fs`; markers via vitest)
- code-quality: FAIL_SOFT (sole cap = knip auditor unavailable offline; manual knip run clean of M9 findings)

## Spawned agents (audit trail)

- architecture-reviewer (SOUND), tests-wiring-reviewer (gaps-found→fixed), cross-validation (86%→100% after fixes), security-robustness (no blockers).

## Handoff decision

**READY_TO_MERGE.** No BLOCKER, no HIGH defect. All actionable HIGH/MEDIUM review findings (test:fast,
lint warnings, EC-1 assertion, ADR-1 file) are FIXED; the remaining MEDIUM/LOW are documented hardening
follow-ups with no current leak or defect. All 7 gaps closed with the wiring triad + tests; full suite
green. Proceed to `/release` for v0.7.0 (minor — `Added`/`Changed`/`Security`, no breaking).
