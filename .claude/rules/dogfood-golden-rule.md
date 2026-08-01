# Dogfood Golden Rule

Locked contract that `/dogfood` reads to evaluate whether a project may legitimately claim `production-ready` / `v1.0`. **This file is a template — each project edits the marked sections to declare its own anchor scenario.**

Without this file, `/dogfood` emits `EVIDENCE_INSUFFICIENT` with flag `golden_rule_missing`.

## § 1 — Anchor scenario (PER-PROJECT — EDIT THIS)

The anchor scenario is the single use case that, if you cannot dogfood it, you cannot claim production-ready. Pick one. Be specific.

**Slug:** `theokit-remote-provider`

**Description:** Um agente **Theokit real** — o `agent-builder`, que a equipe usa — descobre e
carrega uma skill que vive no registry do theo-skills **no ar**: publicada por um publisher de
verdade, servida por credencial cunhada por inquilino, resolvida em tempo de execução. Não é
carga de arquivo local nem fixture: o agente precisa achar a skill que não conhecia e usá-la.

**Why this scenario:** É a promessa central e inteira do produto. Se o agente que a própria
equipe usa não consegue **achar** e **carregar** uma skill do registry, não existe registry —
existe um banco de dados com uma API. O cenário é desconfortável de propósito: ele falha se
qualquer elo (publicação, credencial, descoberta semântica, entrega do corpo, layout de disco
do runtime) estiver quebrado, e cada um desses elos já quebrou pelo menos uma vez.

## § 2 — Status vocabulary (LOCKED — do not change without ADR)

The `Status` field in `knowledge-base/dogfood/manifest.md` MUST take one of these values:

| Status | Meaning |
|---|---|
| `planned` | Anchor is identified but no implementation work has started. |
| `wired` | Implementation lands; the anchor is invoked at least once in CI or a manual smoke. |
| `running` | The anchor is **actively used by the team on real infrastructure**. This is the bar for v1.0. |
| `paused` | Was `running`; explicitly stopped for a documented reason. NOT a degradation of `running`. |
| `abandoned` | Anchor is no longer pursued. Requires ADR to set. |

`/dogfood` accepts `running` as the only value satisfying hard cap #2 (`anchor_not_running`).

## § 3 — Hard caps (LOCKED)

In order; first failure short-circuits to `EVIDENCE_INSUFFICIENT`.

| # | Check | Flag |
|---|---|---|
| 1 | Manifest contains a section identifiable by `Slug` or anchor header | `anchor_missing` |
| 2 | `Status` matches the running value declared in § 2 | `anchor_not_running` |
| 3 | At least one evidence file under `knowledge-base/dogfood/evidence/` has frontmatter `scenario:` matching the anchor slug | `no_anchor_evidence` |
| 4 | The most recent matching evidence file (by frontmatter `date:`) is within the freshness threshold below | `anchor_evidence_stale` |

**Freshness threshold:** `30 days`. Reduce for fast-moving products; never raise without ADR.

## § 4 — Soft caps (PER-PROJECT — EDIT OR EXTEND)

Soft caps cap the verdict at `EVIDENCE_WITH_CAVEATS`. They fire when hard caps pass but evidence is thin.

| Soft cap | Default | Rationale |
|---|---|---|
| Total evidence count for the anchor | ≥ 3 | Single evidence point is not a trend. |
| Failure stories present | ≥ 1 | A dogfood without failures is theatre. |
| Evidence from ≥ 2 different operators | recommended | Avoid "the one person who knows how" syndrome. |

## § 5 — Evidence file frontmatter (LOCKED)

Every file under `knowledge-base/dogfood/evidence/` MUST have YAML frontmatter:

```yaml
---
scenario: <slug>        # matches the anchor slug or a declared sibling
date: YYYY-MM-DD        # local date of the dogfood run
operator: <name>        # who ran it
outcome: pass | partial | fail
summary: <one line>
---
```

Missing any field → evidence file ignored by hard cap #3.

## § 6 — When this rule may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol`, plus one extra requirement:
sign-off from at least one operator who has logged anchor evidence. Rule-specific
deviations:

- Changing the anchor slug = abandoning the previous anchor (requires ADR).
- Loosening the freshness threshold = downgrading the gate (requires ADR).
- Adding a new `Status` value or new hard cap = expanding the contract (requires ADR).

## § 7 — Failure modes the rule guards against

- "Production-ready" claim backed only by synthetic benchmarks.
- Silently swapping the anchor when the original becomes inconvenient.
- Aging evidence (dogfood worked 6 months ago; nothing since).
- Single-operator knowledge (only one person can actually run the anchor).
- Dogfood theatre — checking the box without using the product.
