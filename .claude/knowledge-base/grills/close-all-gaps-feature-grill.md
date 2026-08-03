---
slug: close-all-gaps
feature: Close all cross-validation gaps (M9)
generated_by: roadmap-feature
date: 2026-06-23
status: completed
milestone_id: M9
source: cross-validation-output/final_report.md (loop-cross-validation vs agentic-context-engine)
---

# Feature grill — close-all-gaps (M9)

Answers derived from the 2026-06-23 `/loop-cross-validation` audit (theo-skillregistry vs ACE),
not from a fresh interrogation — the audit already produced evidence-backed answers. User explicitly
chose to scope M9 as "literally all 7 gaps" despite the flagged M8 overlap (tracing) and the YAGNI
item (#7 provider breadth).

## Q1 — What is this feature and why NOW?

Close all 7 engineering gaps surfaced by the cross-validation against ACE: tracing, log scrubbing,
explicit backoff, CLI setup wizard, CLI read commands, test-marker taxonomy, and embedder-provider
breadth. **Why now:** a fresh evidence-backed audit just produced the gap list with exact reference
citations; closing them while the context is hot raises V1 to production-grade engineering parity
(target scored 4.49/5 — the only sub-4 axes are Observability and CLI/DX, both addressed here).

## Q2 — Dependencies (which milestones must be [x])

- **M2** (webhook delivery — gaps #2 scrubbing, #3 backoff touch the delivery worker).
- **M5** (CLI — gaps #4 wizard, #5 commands extend the existing `theoskill`).

NOTE (honesty): gap #1 (tracing) overlaps M8's OpenTelemetry DoD. M9 depends on M2+M5 (what is
needed to START), NOT on M8 — so M9 may become eligible before M8 (M8 is blocked on M7). The
tracing instrumentation MUST be built once and shared (see risk 1) to avoid duplicate spans.

## Q3 — Definition of Done (covers all 7 gaps)

1. **Tracing (#1):** a trace-context (`trace_id`) is propagated HTTP → operation → job → webhook and
   logged on every hop, so one ingestion is followable end-to-end. Coordinated with M8's OTel layer
   (shared setup; no double instrumentation).
2. **Scrubbing (#2):** the JSON logger redacts sensitive keys (secret/token/authorization/password)
   before emitting; a test asserts a known secret never appears in output.
3. **Backoff (#3):** the webhook sender has an explicit exponential-with-jitter backoff policy,
   decoupled from pg-boss queue defaults; covered by a unit test on the delay schedule.
4. **CLI DX (#4 + #5):** `theoskill init` writes a local config (registry URL/auth) so publish needs
   no repeated flags; read commands `status`/`get`/`list`/`revisions` mirror the HTTP API; exit codes
   remain scriptable.
5. **Test markers (#6):** a semantic test-tag taxonomy (e.g. slow/live/integration) enables selective
   CI runs; documented in `rules/testing.md`.
6. **Provider breadth (#7 — included per explicit user request despite YAGNI):** the embedder
   selection becomes a provider registry with auto-detection seam (≥1 provider beyond stub|openai, OR
   a documented seam ready for one). Flagged as speculative — see risk 2.

## Q4 — Top 2 NEW risks

1. **Tracing duplication with M8.** M9 instruments tracing (#1) while M8's DoD also mandates
   OpenTelemetry traces. If both run independently, instrumentation is built twice / spans collide.
   *Mitigation:* build a single shared OTel/trace-context module in M9 that M8 consumes; or sequence
   M9's tracing bullet to land the shared foundation M8 reuses. Document the seam in an ADR.
2. **Provider-breadth is YAGNI.** Building an embedder-provider abstraction (#7) without a concrete
   second consumer risks speculative generality (Unbreakable Rule 11). *Mitigation:* only ship the
   registry SEAM + one real provider that has near-term need; do not build N speculative adapters.
   If no real second provider exists at implementation time, deliver the seam + tests only and record
   the YAGNI deferral in the plan.
