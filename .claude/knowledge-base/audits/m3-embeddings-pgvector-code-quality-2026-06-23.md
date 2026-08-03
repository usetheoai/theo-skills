# Code Quality Audit: m3-embeddings-pgvector

**Date:** 2026-06-23
**Mode:** plan-bound
**Verdict:** PASS
**Score cap:** 100
**Hard caps triggered:** _none_

## Summary

- Languages audited: typescript
- Languages skipped: _none_
- Total findings: 1 (0 HARD, 0 SOFT_CAP, 0 SOFT_FLOOR, 1 INFO)

## Findings by detector

### D1 — Dead code
_No findings._

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `.` | `d2` | INFO | D2 disabled by --no-network flag |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
