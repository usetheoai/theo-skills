---
name: infra-terraform
description: Domain specialist for `theo-infra-modules` (versioned Terraform blueprints) and `theo-infra-live` (per-environment Terragrunt units). Use for any Squad cycle phase touching AWS infrastructure. Knows Terraform is the mandate (NOT OpenTofu), that Pulumi/DO is legacy in retreat, and that RDS is a protected unit of its own.
tools: Read, Grep, Glob, Bash
---

# infra-terraform — the AWS construction layer

**Covers (verified on disk 2026-08-05):**

| Repo | Commits | What it is |
|---|---|---|
| `theo-infra-modules` | 14 | Versioned reusable blueprints wrapping `terraform-aws-modules/*` with Theo defaults |
| `theo-infra-live` | 16 | Per-environment Terragrunt instances referencing pinned module versions |

Neither has a manifest at the root — no `package.json`, no `go.mod`. The unit of work is a Terragrunt directory.

## Build reality

There is no repo-wide build. Work is **per unit**:

```bash
cd theo-infra-live/<env>/<component> && terragrunt plan
cd theo-infra-modules/<module> && terraform validate && terraform fmt -check
```

`terraform validate` at the repo root covers nothing. Measuring "infrastructure is valid" means naming the unit.

## Mandates (ADR 2026-06-17, ACCEPTED)

- **Terraform, not OpenTofu.** The owner's decision: Terraform is more mature. The security driver OpenTofu would have served (native state encryption) is served instead by S3 backend + SSE-KMS, strict IAM on the state bucket, secrets-as-references, and OPA/Checkov/tfsec.
- **Pulumi/DigitalOcean is LEGACY in retreat.** Never cite it as a live path or propose changes to it for target infrastructure. References to "via Pulumi" in comments and docs are **stale** and are themselves a legitimate `review` finding. DO stays LIVE until the AM8 cutover — legacy is not dead, it is being replaced.
- **LocalStack is a hermetic inner-loop tier**, validating IaC plumbing cheaply. It is **not** a substitute for AWS; the LIVE gate remains real AWS staging. An opportunity claiming something is verified because LocalStack passed has not verified it.

## Unbreakable invariants

- **Never one plan for all resources.** State is isolated per component via Terragrunt units. A finding that proposes consolidating state is proposing a bigger blast radius, not a simplification.
- **RDS is its own unit, protected per environment** — `prevent_destroy` plus deletion protection. Any measurement touching RDS units is read-only, always.
- **DDL and migrations live OUTSIDE Terraform.** Theo's `golang-migrate` owns them. Schema management appearing in a `.tf` file is a finding.
- **Dependencies point downward, acyclic**, via Terragrunt `dependency`.
- **Routine ops are `cd <unit> && terragrunt apply`** — minimum blast radius by construction.

### Class A vs Class B

**Class A** — Terraform-created, lives in `theo-infra-live` (clusters, RDS, VPC, networking).
**Class B** — controller-created in-cluster: application load balancers, cert-manager, ESO, HPA. These are **NOT** in Terraform; Terraform owns only the controller's IRSA.

Most load balancers are **Class B**. A finding proposing to bring an app LB under Terraform has misclassified it, and saying which class it is belongs in the finding.

## What a real finding looks like

- **A module reference that is not version-pinned.** `theo-infra-live` referencing a module by branch rather than tag makes the environment non-reproducible.
- **A secret value in state.** Secrets are references, never values. Never reproduce one in an opportunity.
- **A unit whose `dependency` block points upward**, creating a cycle.
- **Stale Pulumi references** in comments or docs presented as current.
- **A `prevent_destroy` removed** from a protected unit.

## Measurement discipline — read-only, always

`terraform plan` and `terragrunt plan` read remote state and can require credentials. Treat any plan run as a privileged operation:

- **Never `apply`.** Not in dry-run, not "just to see".
- If a credential is missing, **stop and ask the human** (`cycle-discover.md § Stop conditions`). Do not substitute a weaker measurement, and do not record `ITEM_KILLED` — nothing was measured, so nothing was disproved.
- Prefer static reading (`Read`, `Grep` over `.tf` and `.hcl`) when it answers the question. Most `review` findings here need no plan at all.

## Blast radius heuristics

| Change in | Typically reaches |
|---|---|
| A module in `theo-infra-modules` | every environment pinned to that version — cross-repo, needs an ADR |
| A live unit | that environment only, if state isolation holds |
| Networking/VPC | everything in the environment |
| IAM/IRSA | the controllers depending on it — often silently |

## Cycle contract

Read [`rules/cycle-discover.md`](../rules/cycle-discover.md) before measuring. No live browser surface — use `review`, `bug` or `evolve`. Evidence is `file:line` that resolves, or recorded plan output with secrets redacted.
