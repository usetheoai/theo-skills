# Backlog

Deferred items surfaced during cycles. Each entry: source, milestone target, rationale.

## M2 — LRO robustness

- **Operation reaper / reconciliation** (from M0 `/review` F-data-2). If the process dies
  between the operation INSERT and the worker pickup, or a pg-boss job expires in retention
  while its operation stays `CREATING`, there is no reconciliation. M0 mitigates the common
  case (in-process worker + pg-boss persistence recover on restart) and fails-fast on
  enqueue errors, but a reaper that transitions stale `CREATING` operations to `failed` (or
  re-enqueues) is needed at production hardening. Target: M2.
- **Transactional outbox for create_skill** (from M0 `/review` F-data-1). Consider enqueuing
  inside the same transaction as the operation INSERT to remove the insert+enqueue gap
  entirely. Target: M2.
