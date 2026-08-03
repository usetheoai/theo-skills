# Review: m5-dev-cli

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 (architecture, tests, cross-validation, security/robustness)
**Findings:** 0 BLOCKER, multiple HIGH (test gaps — fixed), LOW/INFO
**Verdict:** READY_TO_MERGE

## Scope

M5 milestone diff `55613d7^..HEAD`: dev CLI `theoskill` (`validate` + `publish`) sharing the server's
validation via a single `core` orchestrator; new `@usetheo/skillregistry-cli` package + an api
`testkit` for the cross-package E2E.

## Headline verified

The **DRY claim is genuine** (3 of 4 reviewers independently confirmed): `validateSkillPayload` is the
SOLE orchestrator; the server's previously-inlined 4 checks were fully removed; CLI + server both
delegate to it with the SAME yauzl/secretlint adapters. ROADMAP risk #1 (CLI/server divergence) and
#2 (fragile secret regex) are both closed. **Security is sound**: symlinks are NOT packaged (no file
leak), no validation-skip flag exists, no SSRF (user owns the registry URL), secret scan gates every
publish, tsquery/path-traversal safe.

## Findings + resolutions

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| F-test-11/F-test-2 | HIGH | DRY-parity proven only by construction; CLI secret path untested | **FIXED** — CLI `validate` test with a REAL secret-bearing zip (`ghp_…`) through the real secretlint adapter → exit 1 + `[secret_detected]` + detail line. |
| F-test-3 | HIGH | publish POST/PATCH body shape unasserted | **FIXED** — assert POST `{skill_id, base64 zippedFilesystem}` and PATCH `{zippedFilesystem}` + `updateMask`. |
| F-test-4 | HIGH | non-202 registry response untested | **FIXED** — 400 → exit 1 with `registry rejected … HTTP 400: invalid_zip`. |
| F-test-5/F-sec-1 | HIGH | `packageSkill`/zip untested; symlink-skip undocumented | **FIXED** — zip.contract test (nested dir→posix entries, lone SKILL.md, .zip passthrough, **symlink NOT packaged**); docstring corrected. |
| F-test-1 | HIGH | frontmatter-before-secret order untested | **FIXED** — order test (frontmatter wins over secret). |
| F-test-9 | MED | `index.ts main()` dispatch untested | **FIXED** — index.contract test (help/unknown/no-path/missing-flags). |
| F-test-8 | MED | args publish-no-flags + unknown-flag untested | **FIXED** — args tests added. |
| F-test-7/F-test-13 | MED | E2E UPDATE didn't verify a 2nd revision; weak poll | **FIXED** — assert create reached 200, then assert `revisions.length === 2`. |
| F-arch-4/F-xval-2 | LOW | `./app` orphan export | **FIXED** — removed the unused export + aliases. |
| F-arch-7 | LOW | publish GET→POST TOCTOU | **FIXED** — POST 409 → transparent PATCH fallback (collapses the race). |
| F-arch-11 | INFO | docstring "four checks" | **FIXED** — "three checks". |
| F-xval-1/F-test-6 | HIGH→resolved | E2E gated on `THEOSKILL_PG_URI` (repo convention) | RAN GREEN locally with PG (2/2) — DoD-3 verified; consistent with all api integration tests. |
| F-arch-5/F-sec-2/F-sec-4 | LOW/INFO | testkit in shipped pkg; unbounded in-mem zip; no URL scheme check | ACCEPTED — private workspace pkg; dev tool over author-owned files/registry; auth/limits noted for the roadmap. |

## Cross-validation summary

Per-task T1.1–T4.1 implemented. Wiring triad: bin `theoskill` → `index.ts` dispatches with real
adapters; integration test (E2E); observable output (per-rule errors + exit codes). DoD: (1) CLI runs
the SAME 4 checks via the shared orchestrator + same adapters — DRY genuine; (2) publish packages +
reuses Create/Update (POST/PATCH) with per-rule errors; (3) E2E validate→publish→retrieve green
against a real in-process registry. CHANGELOG updated; `yazl` the only new dep (justified, 0 CVEs).

## Quality gates

- typecheck PASS · lint 0/0 · code-quality PASS (cap 100, 0 caps)
- 209 tests green: core 56 + api 48+76 + cli 27+2
- deps-audit: 0 CVEs; 1 new runtime dep (`yazl`) — Rule 9 honored (server reads yauzl, CLI writes yazl)

## Handoff decision

**READY_TO_MERGE.** No BLOCKER. The DRY headline + security posture are verified by independent
reviewers. All HIGH test-gaps are closed (parity, zip/symlink, publish body, secret, index dispatch);
the TOCTOU and orphan-export LOWs are fixed. Proceed to `/release` for v0.6.0 (minor — `Added` +
`Changed`, no breaking).
