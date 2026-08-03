# Discover-Confidence — theokit-registry-contract (blueprint)

Date: 2026-06-23
Blueprint: .claude/knowledge-base/discoveries/blueprints/theokit-registry-contract-blueprint.md

## Verdict: SHIPPABLE (99.7)

| Dimension | Score |
|---|---|
| research_coverage | 100.0 (4/4 corners populated) |
| reference_citations | 100.0 (20 unique paths, 0 fabricated — Step 7 verified) |
| blueprint_completeness | 100.0 (Header, Context, 4 corners, Cross-cutting, 2 ADRs, Recommendations) |
| structural_risk | 98.0 |
| **final_score_after_caps** | **99.7** · hard_caps: none |

## Cycle-discover summary (all phases green)

| Phase | Skill | Outcome |
|---|---|---|
| 1 | `/discover-plan` | plan written (7 Qs, 4 corners) |
| 2 | `/discover-edge-cases` | 2 MUST-FIX absorbed (v0.1.1) |
| 3 | `/discover-plan-confidence` | SHIPPABLE 99.7 (after fixing a tooling bug — ADR 0001) |
| 4 | `/discover-execute` | BLUEPRINT_COMPLETE, 7/7 answered, 0 blocked |
| 5 | `/discover-confidence` | **SHIPPABLE 99.7** |

## What the blueprint delivers (feeds M7 DoD)

1. **D1 — separate `/v1/strategies` resource** for learned records (do not overload `/v1/skills`).
2. **D2 — registry = ACE `safe_mode` persistence backend**; runtime verbs (`ask`/`learn.*`) excluded → Theokit.
3. Curation surface: atomic `UpdateBatch` (ADD/UPDATE/TAG/REMOVE), soft-delete via `active`, counter-based TAG.
4. Transport: HTTP `/v1` direct (already have); MCP wrapper optional.
5. No new ranking deps — pgvector M4 supersedes BM25/embedding libs.
6. Integration-test shape: lifecycle (create→curate→retrieve→deactivate) + ACE curation invariants.

## Note

No skill-distillation tail (`/skill-writer`) — this is a contract blueprint feeding a milestone DoD,
not a reusable `*-patterns` skill. The blueprint is the terminal artifact of this discovery cycle.
