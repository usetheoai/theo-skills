# Review: m2-lro-governance-webhook

**Date:** 2026-06-23
**Reviewers (spawned agents):** 5 (architecture, tests, security-webhook, cross-validation, concurrency/data-integrity) + 1 adversarial re-verification of the BLOCKER fix
**Findings:** 1 BLOCKER (fixed), 8 HIGH (fixed/mitigated), 9 MEDIUM (fixed/accepted), LOW/INFO
**Verdict:** READY_TO_MERGE

## Scope

M2 milestone diff `045db68^..HEAD` (commits 045db68, 6960fb9, 22487b3, 2920af6, 65ca5bf, ee65f86):
LRO lifecycle (states/idempotency/retry) + webhook system (SSRF guard, HMAC signing, pinned HTTP
sender, endpoints CRUD, delivery pipeline with enqueuer/worker/reconciler).

## BLOCKER findings (all resolved)

### F-sec-1: SSRF guard ran only at registration, never at delivery (DNS-rebind / TOCTOU) — FIXED
- Severity: BLOCKER
- Found by: security-webhook
- File: packages/api/src/server/webhooks/webhook-delivery-worker.ts:57 (original)
- Problem: an attacker registers `https://rebind.evil` (resolves public at registration), which
  re-resolves to `169.254.169.254` / `127.0.0.1` / RFC1918 at delivery time. The signed webhook was
  POSTed to the internal target → outbound SSRF into cloud metadata / internal network.
- Fix (commit 65ca5bf): the HTTP sender was rewritten on `node:http(s)` (zero new deps) to
  (a) re-validate the target at SEND time via `resolveSafeAddresses`, and (b) PIN the TCP connection
  to the validated IP via a custom `lookup` callback — the IP validated is the IP connected, closing
  the TOCTOU. Redirects are not followed; SNI/`servername` preserved for TLS; response body drained
  (no DoS). `UrlSafetyError` at delivery → `markFailed` non-retriable.
- Re-verification (adversarial, independent agent): **F-sec-1 CLOSED, F-sec-2 CLOSED.** Validate-all-
  then-pin is fail-closed (a mixed public/private DNS answer rejects the whole URL); single production
  sender, no bypass path; SNI intact so TLS cert validation is not weakened.

## HIGH findings (all resolved or mitigated)

| Finding | Resolution |
|---|---|
| F-sec-2: no IP pinning between validation and connection | FIXED — same pinned-lookup fix as F-sec-1 |
| F-test-1: DLQ exhaustion path untested | FIXED — DLQ handler test (webhook-delivery-unit) |
| F-test-2: network-error transient retry untested | FIXED — E2E `retries on a transient network error then delivers` |
| F-test-3: endpoint-deleted/inactive mid-delivery untested | FIXED — handler edge tests (missing row no-op; inactive → markFailed) |
| F-xval-1: 3 declared concurrency tests missing | FIXED — concurrent same-key create; 2-reconciler no-double-send; disjoint claim batches |
| F-conc-2: crash-after-send double-delivery | MITIGATED + documented — at-least-once contract; stable `webhook-id` dedup header (doc comment in enqueuer) |
| F-conc-9: stuck delivery (lost DLQ event) invisible to orphan scan | FIXED — `listStuckDeliveries` + second reconciler sweep + E2E test |

## MEDIUM findings

| Finding | Resolution |
|---|---|
| F-arch-1: `WebhookDeliveryRow` (ORM) leaked across port boundary | FIXED — `DeliveryRecord` domain type at the boundary |
| F-test-4: event-type filter exclusion untested at pipeline level | FIXED — E2E `does NOT deliver … excludes the event` |
| F-test-6: SSRF test omitted CGNAT/mapped/unique-local/boundary cases | FIXED — boundary + counter-example tests added |
| F-conc-6: concurrent same-key create path untested | FIXED — `Promise.all` race test |
| F-test-7: transient-retry boundary untested | FIXED — `worker RETRIES a transient error and reaches ACTIVE` |
| N-1: pin to `addresses[0]` only, no multi-A failover | ACCEPTED (documented) — single-A is the common case; happy-eyeballs failover is an availability optimization, not a correctness/security concern (YAGNI) |
| F-test-5: E2E signature uses real wall-clock | ACCEPTED — passes deterministically (300s window ≫ test runtime); signing skew is covered deterministically by the contract test |
| F-conc-5: orphan grace window is a heuristic | ACCEPTED — singletonKey is the real safety net; grace reduces churn |
| F-conc-1: attemptCount under-counts under terminal-once guard | ACCEPTED — at-least-once with idempotent terminal marking is correct; counter is a lower bound |

## Cross-validation summary

Per-task coverage: T1.1–T5.1 all fully implemented (commits mapped). Wiring triad satisfied for every
new public feature: onTerminal hook wired worker→enqueuer; delivery worker + DLQ registered; reconciler
started + in graceful drain order (server→reconciler→queue→pool); DELETE→async LRO; Idempotency-Key
end-to-end; CHANGELOG updated; migration 0003 matches schema.ts.

## Quality gates summary

- typecheck: PASS (core + api)
- lint: PASS (0 warnings)
- tests: PASS — core 18, api contract 37, integration 42 (97 total)
- /code-quality: PASS (score cap 100, 0 hard/soft caps; D2 via `--no-network`, tsc strict is the
  authoritative anti-fabrication gate)
- Zero new dependencies (node:crypto/dns/net/http/https + pg-boss) — Unbreakable Rule 9

## Handoff decision

**READY_TO_MERGE.** The single BLOCKER (delivery-time SSRF) is closed and independently re-verified.
All HIGH findings are fixed or mitigated-with-documentation. Remaining MEDIUMs are fixed or accepted
as documented trade-offs (YAGNI/availability). Proceed to `/release` for v0.3.0 (minor — `Added`
present, no breaking changes).
