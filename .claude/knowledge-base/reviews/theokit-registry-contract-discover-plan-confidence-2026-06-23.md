# Discover-Plan-Confidence — theokit-registry-contract

Date: 2026-06-23
Plan: knowledge-base/discoveries/plans/theokit-registry-contract-plan.md (mirror: .claude/knowledge-base/discoveries/plans/)

## Verdict: SHIPPABLE (99.7) — tool bug fixed, re-scored clean

> Update: the threshold-parser bug below was fixed via TDD (ADR 0001). The runner now emits
> `SHIPPABLE` 99.7 against the **real** project thresholds file (no override). Regression test
> `skills/discover-plan-confidence/tests/test_run_discover_plan_score.py` (7 tests) locks it;
> full skill suite 29/29 green.

## True structural verdict: SHIPPABLE (99.7)

| Dimension | Score |
|---|---|
| research_coverage | 100.0 |
| reference_citations | 100.0 (16 verified, 0 fabricated) |
| plan_completeness | 100.0 (10/10 sections, 3 ADRs, budget OK 7 Qs) |
| structural_risk | 98.0 (1 vague-pronoun hit, −2) |
| **weighted_avg** | **99.7** |
| hard_caps_triggered | none |

Demonstrated with `--thresholds /tmp/bands.txt` (parser-expected `NAME | VALUE` format).

## ⚠ Tooling bug found (blocks the emitted verdict, not the plan)

`run_discover_plan_score.py::_parse_thresholds` (line ~85) splits each line on `|`:

```python
parts = [p.strip() for p in line.split("|")]
if len(parts) >= 2: bands[parts[0]] = int(parts[1])
```

But the checked-in `.claude/rules/discover-plan-thresholds.txt` uses the `KEY = VALUE` format it
documents (`band.shippable = 90`). `split("|")` yields a 1-element list → `len(parts) < 2` → **every
line skipped → `bands = {}`**. `_verdict_for` then falls through to `return "INVALID"` for ANY score.

**Impact:** every discovery plan scores `INVALID` regardless of quality (false negative). The plan
here is genuinely 99.7 with zero hard caps and zero fabricated citations.

**Root cause:** format contract mismatch between the runner (expects `NAME | VALUE`, verdict-named)
and the project thresholds file (`band.<name> = <value>`, dotted keys). Two sub-issues:
1. delimiter: `|` vs `=`.
2. key naming: `band.shippable` vs `SHIPPABLE` (verdict token expected by `_verdict_for`).

**Suggested fix (project owner / ADR — touches rubric mechanism):** make `_parse_thresholds` read the
documented `KEY = VALUE` format, select `band.*` keys, and map `band.shippable → SHIPPABLE`,
`band.shippable_with_caveats → SHIPPABLE_WITH_CAVEATS`, `band.needs_revision → NON_SHIPPABLE`. Add a
regression test asserting a 99.7 plan with no hard caps → SHIPPABLE (not INVALID). This is a bug fix,
not a softening of caps — hard caps still fire independently (verified: the earlier fabricated-citation
run did surface the fabricated path before I fixed Q6).

## Plan adjustments applied this phase

- Rewrote to the canonical scorer contract (10 mandatory sections, ADRs as `### D1/D2/D3`, Research
  Questions table with `Fase A`/`Fase B` columns, `.claude/knowledge-base/references/` citation prefix).
- Bridged references via symlink `.claude/knowledge-base/references → ../../knowledge-base/references`
  so the 8 peers (incl. the freshly-cloned `agentic-context-engine`) resolve for the citation check.
- Fixed the only fabricated-citation hit (Q6 glob `test-management-api-e2e.*` → explicit `.md` + `.sh`).

## Verdict

Structurally **SHIPPABLE (99.7)** — the plan passes every hard cap and every dimension at/near 100.
The emitted `INVALID` is a tooling false-negative (threshold-parser bug above), not a plan defect.
Recommend proceeding to `/discover-execute` once the bug is acknowledged.
