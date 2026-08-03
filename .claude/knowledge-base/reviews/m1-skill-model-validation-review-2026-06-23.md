# Review: m1-skill-model-validation

**Date:** 2026-06-23
**Reviewers (spawned agents):** 5 — architecture, security, tests, cross-validation, domain-data
**Diff base:** 2d8f830..HEAD
**Findings:** 1 BLOCKER, 5 HIGH, several MEDIUM/LOW — **all actionable items fixed; none dismissed**

## Verdict: `READY_TO_MERGE`

The review found a real BLOCKER and multiple HIGH/security findings. Every actionable finding
was **fixed** (not waved away) and re-validated green.

## Findings & resolution

| ID | Sev | Summary | Resolution |
|---|---|---|---|
| F-data-1 | **BLOCKER** | Deleted skill_id could NEVER be recreated (tombstone PK survives; create → permanent failed) | **Fixed** — `createWithRevision` atomically purges an expired tombstone + its revisions before insert; live/reserved id still conflicts. Test: delete→expire→recreate succeeds; active reservation still blocks |
| F-data-2 | HIGH | No index on `skill_revisions.skill_id` → seq-scan on listBySkill | **Fixed** — composite index `(skill_id, create_time desc)`; migration 0002 |
| F-test-1 | HIGH | `GET /v1/skills/:id/revisions/:revId` endpoint untested | **Fixed** — E2E: get-by-id 200, unknown→404, cross-skill→404 |
| F-test-2 | HIGH | `too_many_entries` / `total_too_large` guards untested | **Fixed** — pure checkEntry tests drive the accumulators past the caps |
| F-xval-1 / F-test-4 | HIGH | Declared concurrent-update convergence test missing | **Fixed** — E2E: 2 concurrent PATCH payloads → 3 revisions, latest is one of them |
| F-test-3 | HIGH | secretlint contract test unreadable by the agent (permission filter) → "unverified" | **No defect** — the test exists and asserts value-never-leaked (`JSON.stringify(f) not.toContain(token)` + only `{file,type}` keys); the agent was blocked by a `secret*` read filter, not a missing test |
| F-sec-1 | MEDIUM | No inbound body-size limit → memory DoS | **Fixed** — Hono `bodyLimit` on POST/PATCH → 413 (`THEOSKILL_MAX_BODY_BYTES`, default 35MB); tested |
| F-sec-2 | MEDIUM | 500MB payload amplification into a pg-boss job row | **Mitigated** — body limit bounds inbound size; full object-storage offload documented as post-M1 (ROADMAP/backlog) |
| F-sec-7 | LOW | PATCH enqueue failure left a stuck operation | **Fixed** — shared `enqueueOperation` helper marks the operation `failed` on enqueue error (uniform with POST) |
| F-arch-2 | MEDIUM | 256-line god-handler | **Partially addressed** — extracted the duplicated create-op+enqueue+log seam into `enqueueOperation` (DRY); full read/mutate split deferred (proportionate, documented) |
| F-arch-4 | LOW | Dead `MAX_COMPATIBILITY_LENGTH` | **Fixed** — removed |
| F-arch-5 | LOW | `entryCount` unused | **Fixed** — emitted as `entry_count` in the create runtime-metric log |
| F-test-5 | LOW | Concurrent-create under-asserted | **Fixed** — asserts exactly 1 `skill_revisions` row (no orphan) |
| F-test-7 | LOW | Malformed-YAML test could pass with 0 assertions | **Fixed** — `expect.assertions(2)` |
| F-sec-3 | LOW | DOS-attr symlink could evade the unix-mode check | **Documented** — no filesystem sink in M1 (nothing extracts to disk); content-based symlink refusal noted for the future extraction service |
| F-arch-3, F-data-4/5/6, F-test-6/8/9 | LOW/INFO | id-validation on GET, last-writer-wins, missing FKs, base64-in-job, poll flake budget, traversal-via-HTTP | Acceptable M1 scope / documented; verified-safe positives recorded |

## Cross-validation summary

- Plan tasks: 9 — all FULLY_IMPLEMENTED after fixes.
- ROADMAP M1 DoD (3 bullets): each backed by real code + real tests (Theokit-compatible
  frontmatter parser; zip validation with all guards + secret scan; full CRUD + immutable
  revisions + skillId validated and reserved post-delete with a **configurable** window).
- ADRs honored: ADR-1 (boundary fail-fast), ADR-2 (yauzl/yaml/secretlint, gray-matter→yaml CVE
  switch), ADR-3 (immutable revisions), ADR-4 (unknown frontmatter preserved), ADR-5 (configurable
  reservation; sync delete + recyclable after expiry).

## Security review summary

Headline threats verified defended: zip-slip rejected for all tested bypasses **and** no disk
sink; zip-bomb blocked (guards from metadata before any decompress + yauzl `validateEntrySizes`);
eemeli `yaml` defends alias-bomb (`maxAliasCount=100`), no RCE tag surface (the avoided js-yaml CVE
does not recur); secret scanner emits only `{file,type}`, `maskSecrets:true`. The exploitable
weakness was resource-exhaustion (no body cap) — fixed with `bodyLimit`/413.

## Quality gates

- `pnpm -r typecheck` — PASS · `pnpm -r lint` — PASS (0/0)
- `pnpm -r test` (contract) — PASS (core 18 + api 23 = 41)
- `pnpm -r test:integration` (real Postgres) — PASS (core 1 + api 17 = 18, incl. E2E + concurrency + BLOCKER regression)
- `pnpm --filter @usetheo/skillregistry build` — PASS
- `/code-quality` — PASS · `/deps-audit` — clean (js-yaml CVE resolved)

## Spawned agents (audit trail)

architecture · security · tests · cross-validation · domain-data (5 parallel reviewers).

## Handoff decision

`READY_TO_MERGE` — BLOCKER fixed and regression-tested, all HIGH resolved, security DoS guarded.
All DoDs and acceptance criteria validated. Next (human-gated): `/release` to cut M1.
