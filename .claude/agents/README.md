# Squad domain specialists

Eight agents, one per domain of the Theo ecosystem. Each knows the repos it covers, the build commands **verified on disk** rather than copied from a table, the invariants of its domain, and the shapes a real finding takes there.

`domain` on a `B-NNN` item routes to exactly one of these (`rules/cycle-backlog.md § Domain routing`). Work spanning two domains is two items — gate G3.

| Agent | Repos | Live surface | Distinguishing risk |
|---|---|---|---|
| [`engine-go`](engine-go.md) | `theo` | — | Root `go build ./...` covers almost nothing (multi-module) |
| [`control-plane`](control-plane.md) | `theo-cloud`, `theo-traefik-mcp` | ✅ | Cross-tenant leakage; metering that mis-counts money |
| [`data-plane-ts`](data-plane-ts.md) | `theo-memory`, `theo-rag`, `theo-lens`, `theo-trust`, `theo-skills`, `theo-promptly` | — | Tenant isolation; SDK/REST/MCP drift |
| [`theo-db`](theo-db.md) | `theo-db` | — | A defect crashes the database; AGPL licence gate |
| [`infra-terraform`](infra-terraform.md) | `theo-infra-modules`, `theo-infra-live` | — | Blast radius is an environment; RDS is protected |
| [`contracts-auth`](contracts-auth.md) | `theo-contracts` | — | Everything imports it — assume cross-repo by default |
| [`frontend-dashboard`](frontend-dashboard.md) | `theo-cloud/dashboard` | ✅ | Environment vs product |
| [`platform-cli`](platform-cli.md) | `theo-cli`, `theo-storage` | — | `npm`, not `pnpm`; consumers are scripts, not importers |

## Why these eight, and not twenty-one

One agent per repo would duplicate the same six TypeScript facts six times and rot six times as fast. One agent per role (backend / frontend / SRE) would be too coarse to carry an invariant like "RDS is a protected unit" or "a root `go build` covers nothing here". The domains are the granularity at which the **invariants** differ.

## What each agent is required to carry

1. **Repos verified on disk** — `find -maxdepth 2 -name .git` plus `git -C <repo> rev-list --count HEAD`, never an inventory table.
2. **Build commands that were checked**, with the manifest that proves them.
3. **The domain's invariants** — what is never done here, and why.
4. **The shape of a real finding**, and the false positives this domain generates.
5. **Blast-radius heuristics** — what a change here typically reaches.

## Verified inventory, 2026-08-05

Measured, not copied. Two corrections worth keeping visible, because both were live in the umbrella's `CLAUDE.md` and both would have produced confident wrong measurements:

- **`theo-cli` uses `npm`, not `pnpm`.** The table groups it with the six data-plane repos under one `pnpm test` row. A test run under the wrong package manager resolves a different dependency graph than the lockfile pins — green, and testing something other than what ships.
- **Five repos the table names have no checkout**: `theo-contextify`, `theo-gateway`, `theo-sandboox`, `theokit-app`, `theo-itself`. The table states it was "verified 2026-07-28" and that a repo absent from it does not exist in the folder. A week later, five of its entries were absent from disk.

This is why `skills/backlog-init/SKILL.md` mandates reading the inventory from disk, and why every agent here cites what it measured. Documentation drifts; a routing table naming a repo nobody cloned sends work to a specialist who cannot open the code.

## Related

- Routing table: [`rules/cycle-backlog.md`](../rules/cycle-backlog.md)
- Evidence contracts per mode: [`rules/cycle-discover.md`](../rules/cycle-discover.md)
- Live environments: [`rules/live-target.txt`](../rules/live-target.txt)
- Constraint lens: [`rules/current-constraint.md`](../rules/current-constraint.md)
