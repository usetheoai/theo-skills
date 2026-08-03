# Discover Edge Case Review — theokit-registry-contract

Date: 2026-06-23
Discovery plan analyzed: knowledge-base/discoveries/plans/theokit-registry-contract-plan.md
Research questions analyzed: 7
Edge cases found: 8 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 3)

## MUST FIX

### EC-1: Q2 method too vague — `find -name '*.py'` will not deterministically locate the skill schema
- **Affected question:** Q2 (data-model fork)
- **Family:** Method
- **Scenario:** `agentskills-spec/skills-ref/` contains `src/`, `tests/`, `pyproject.toml`. `find -name '*.py'` returns many files; the execute loop wanders trying to find which one holds the skill schema.
- **Impact:** Either wasted iterations or the fork recommendation gets built on the wrong file → invalid blueprint conclusion.
- **Suggested fix:** Pin the method to `Grep 'class .*Skill|schema|model' knowledge-base/references/agentskills-spec/skills-ref/src/` then read the matched file.

### EC-2: Q2 depends on Q1 + Q3 but the order is not declared
- **Affected question:** Q2 (depends on Q1 curation verbs + Q3 boundary)
- **Family:** Dependency
- **Scenario:** Q2's fork recommendation (overload `/v1/skills` vs new `/v1/strategies`) needs the curation-verb list (Q1) and the registry/runtime boundary (Q3) already answered. If executed first, it produces a premature conclusion.
- **Impact:** Unbacked or contradicted recommendation; rework when Q1/Q3 land.
- **Suggested fix:** Add to §5: "Execution order: Q1 → Q3 → Q2; Q5 after Q3 (needs the boundary)."

## SHOULD TEST

### EC-3: Q3 reads a large generated `openapi.json` in full
- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** Before reading, extract routes with `grep '"/' .../api/openapi.json` or `jq '.paths|keys'`; only full-read the relevant path objects — do not dump the whole file into context.

### EC-4: Q3 route-inventory can scope-creep across a large gateway
- **Affected question:** Q3 (`mcp-gateway-registry` is a big repo)
- **Suggested halt-loop checkpoint:** Stop the inventory once curation + discovery verbs are catalogued; auth/infra/transport routes are out of scope (per §3) — do not enumerate them.

### EC-5: blueprint could cite the `/tmp` ACE copy instead of the references copy
- **Affected question:** All ACE-citing questions (Q1, Q3, Q4, Q7)
- **Suggested halt-loop checkpoint:** Already in §7 ("no `/tmp` paths in blueprint"); reinforce — grep the blueprint for `/tmp/` before marking any sub-task DONE; rewrite to `knowledge-base/references/agentic-context-engine/`.

## DOCUMENT

### EC-6: ACE clone used `--depth 1 --filter=blob:none`
- **Accepted risk:** The checkout materialized the 311 working-tree files (verified: `skillbook.py`, MCP handlers, both test files read OK). Only files NOT in the working tree would need a network fetch — none are cited. If `/discover-execute` runs offline, working-tree reads still succeed. Accept.

### EC-7: `composio/package.json` is a workspace root (deps may live in sub-packages)
- **Accepted risk:** Q5 uses composio only as a *dependency signal*, not an authoritative dep list. The authoritative deps come from `semantic-router/pyproject.toml` + `agentic-context-engine/pyproject.toml`. A thin root manifest does not invalidate the answer. Accept.

### EC-8: Q2 (fork) and Q4 (transport) require interpretation, not extraction
- **Accepted risk:** Both are judgment calls. Mitigated by the §8 acceptance criterion "≥ 2 cited precedents per recommendation" and the §2 "no runtime route" invariant. The interpretive nature is inherent to a *contract design* discovery; accept with the precedent-count guard.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 3 | 2 | 0 | 1 |
| Q3 | 3 | 0 | 3 | 0 |
| Q4 | 1 | 0 | 0 | 1 |
| Q5 | 1 | 0 | 0 | 1 |
| Q6 | 0 | 0 | 0 | 0 |
| Q7 | 0 | 0 | 0 | 0 |
| cross-cutting | 1 | 0 | 1(EC-5) | 1(EC-6) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX — both small method/order refinements, not scope changes).
