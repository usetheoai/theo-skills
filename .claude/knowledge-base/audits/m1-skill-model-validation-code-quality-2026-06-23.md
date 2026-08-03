# Code-Quality Audit — m1-skill-model-validation

**Date:** 2026-06-23 · **Mode:** standalone · **Languages:** typescript

## Verdict: `PASS`

| Detector | Result |
|---|---|
| D1 — Dead code | No findings. |
| D2 — Symbol fabrication | Registry unreliable en-masse → run offline; emitted as INFO (see note). |
| D3 — Cross-package wiring | No orphan exports. |
| D4 — Mutation testing | Not run (no `## Critical paths` binding). |

`hard_caps`: [] · `soft_caps`: [] · severity: HARD 0, SOFT_CAP 0, SOFT_FLOOR 0, INFO 1.

## Note on D2 (TypeScript) — investigated, not bypassed

A network-on run reported 378 `symbol_fab_unverifiable_typescript`. This was root-caused, not
waved away:

- D2 for TS does a **live npm-registry HTTP lookup per import** (`package_exists_on_npm`). Run
  en masse by the orchestrator the calls get **rate-limited (429 → "ambiguous" → unverifiable)**.
  The registry disk cache holds only `go.json`/`rust.json` — npm results are not persisted, so
  every run re-queries and re-throttles.
- It is **not** fabrication. Proof:
  1. `tsc --strict` PASSES for both packages — a fabricated symbol/package fails compilation.
  2. `pnpm install` resolved and installed every dependency.
  3. Each of the 13 external packages verifies `True` on an individual registry lookup:
     drizzle-orm, hono, @hono/node-server, @paralleldrive/cuid2, pg, pg-boss, @secretlint/core,
     @secretlint/secretlint-rule-preset-recommend, @secretlint/types, vitest, yaml, yauzl, zod.
- Per SKILL § CLI flags (EC-25), the audit was re-run with `--no-network`. The authoritative
  anti-fabrication gate for TypeScript is the compiler; D2's registry check is redundant when
  the registry can't be hammered reliably.

## Supporting gates

- `pnpm -r typecheck` — PASS (TS strict, both packages).
- `pnpm -r lint` — PASS (0 errors, 0 warnings).
- `pnpm -r test` (contract) — PASS (core 18 + api 21 = 39).
- `pnpm -r test:integration` (real Postgres) — PASS (core 1 + api 13 = 14, incl. E2E + concurrency).
- `pnpm --filter @usetheo/skillregistry build` — PASS.
- `/deps-audit` — clean (js-yaml CVE resolved by switching gray-matter→yaml).

## Handoff

Verdict `PASS` → cleared to proceed to `/review`.
