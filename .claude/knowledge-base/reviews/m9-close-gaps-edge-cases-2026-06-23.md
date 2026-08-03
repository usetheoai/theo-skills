# Edge Case Review — m9-close-gaps

Date: 2026-06-23
Tasks analyzed: 10
Edge cases found: 9 (MUST FIX: 3, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: trace_id may never reach the webhook enqueue path → end-to-end breaks
- **Affected task:** T1.3
- **Family:** State
- **Scenario:** `enqueueOperation` puts `trace_id` in the CREATE/UPDATE job data, but the **webhook delivery job** is enqueued later (on the skill event). If the webhook enqueue happens in a decoupled path (reconciler scanning revisions) rather than inside the same worker that holds the job's `trace_id`, the webhook log gets a *new* trace_id and the chain is broken — defeating the core DoD ("rastreável ponta-a-ponta").
- **Impact:** The headline DoD (#1) silently fails: HTTP→op→job logs share a trace_id, but the webhook hop has a different one.
- **Suggested fix:** Verify the webhook-enqueue path first. If it runs inside the worker (has the job's trace_id) → pass it through. If it is decoupled (reconciler) → **persist `trace_id` on the operation row** (operations store) and have the webhook-enqueuer read `op.trace_id`. Add an integration assertion that the webhook log's trace_id equals the enqueue log's trace_id (already in T1.3 TDD — make it the load-bearing assertion).

### EC-2: pg-boss declarative retry applies exponential backoff but NOT our full-jitter at runtime
- **Affected task:** T2.2
- **Family:** Format / Honesty
- **Scenario:** ADR-2 derives `retryDelay`/`retryBackoff:true` from the policy, but pg-boss's `retryBackoff` is **exponential without jitter** — it does not call our `computeBackoff` per attempt. So the full-jitter is unit-tested (T2.1) but never actually applied by the queue at runtime.
- **Impact:** Claiming "jittered backoff" at runtime when only exponential (no jitter) is applied is a Rule-3 honesty violation.
- **Suggested fix:** State the runtime behavior accurately in the plan/ADR-2: pg-boss applies **exponential** backoff from `retryDelay`; full-jitter is the documented policy that the unit test pins and that any manual/in-handler retry path uses. Do NOT claim queue-level jitter. (≤1 sentence ADR clarification — no code change to the queue.)

### EC-3: scrubbing over-redacts the existing `secret_findings` diagnostic field
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `handlers/skills.ts:73` already logs `{ secret_findings: result.details }` where details are finding **types** (e.g., `"config.env: AWSKey"`), not secret values — a useful diagnostic. A substring match on `secret` would redact this field to `[REDACTED]`, losing diagnostics (and surprising operators).
- **Impact:** Usability regression; an existing legitimate log becomes opaque.
- **Suggested fix:** Define the sensitive-key match precisely: redact when the lowercased key is exactly in `{authorization, password, token, secret}` OR ends with `_token`/`_secret`/`_key`/`_password`. `secret_findings` then does NOT match. Add a test pinning that `secret_findings` is preserved while `authorization`/`api_token` are redacted.

## SHOULD TEST

### EC-4: malformed/spoofed incoming `traceparent` header
- **Affected task:** T1.3
- **Suggested test:** `test_enqueueOperation_generates_traceid_when_incoming_header_malformed` — assert a valid hex-32 trace_id is generated (not the bad header echoed).

### EC-5: backoff with extreme/negative attempt
- **Affected task:** T2.1
- **Suggested test:** `test_computeBackoff_large_attempt_returns_cap` (attempt=64 → cap, never Infinity/NaN) and `test_computeBackoff_clamps_negative_attempt` (attempt<0 treated as 0).

### EC-6: malformed `.theoskillrc`
- **Affected task:** T3.1
- **Suggested test:** `test_loadConfig_returns_empty_on_malformed_json` — corrupt file → `{}` (or typed error), never a crash.

### EC-7: read command missing required arg / config auth not applied
- **Affected task:** T3.3
- **Suggested test:** `test_get_without_skill_id_exits_2_usage`; `test_read_sends_auth_header_from_config` — when config has auth, the read request carries the `Authorization` header.

## DOCUMENT

### EC-8: config resolution location (cwd)
- **Affected task:** T3.1
- **Accepted risk:** `.theoskillrc` resolved from the current working directory (documented). Walking up the tree is out of scope; running publish in another dir simply needs `--registry` or a local config.

### EC-9: vitest marker-selection command portability
- **Affected task:** T4.1
- **Accepted risk:** Negative-lookahead `-t` filtering may not be supported by all vitest versions. The plan already validates the actual command; if unsupported, fall back to a documented `--exclude`/project-split command. Documented, not blocking.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-3) | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 2 | 1 (EC-1) | 1 (EC-4) | 0 |
| T2.1 | 1 | 0 | 1 (EC-5) | 0 |
| T2.2 | 1 | 1 (EC-2) | 0 | 0 |
| T3.1 | 2 | 0 | 1 (EC-6) | 1 (EC-8) |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 1 (EC-7) | 0 |
| T4.1 | 1 | 0 | 0 | 1 (EC-9) |
| T4.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (3 MUST FIX — all small: 1 design-verify (trace→webhook), 1 honesty clarification (pg-boss jitter), 1 precise-match (scrubbing).)
