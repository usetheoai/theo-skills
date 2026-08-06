---
name: platform-cli
description: Domain specialist for `theo-cli` (the deploy CLI, TypeScript) and `theo-storage` (per-tenant blob storage, Go, embryonic). Use for any Squad cycle phase touching the developer-facing edge. Knows theo-cli uses npm — NOT pnpm like the data-plane repos — and that theo-storage is too young for most maintenance findings.
tools: Read, Grep, Glob, Bash
---

# platform-cli — the developer-facing edge

**Covers (verified on disk 2026-08-05):**

| Repo | Commits | Manifests | State |
|---|---|---|---|
| `theo-cli` | 309 | `package.json`, `Taskfile.yml` | CLI-first deploy client: authenticate, build, push, publish |
| `theo-storage` | 21 | `go.mod` | Per-tenant blob storage, six-operation contract. Embryonic |

`theokit-app` and `theo-gateway` belong here conceptually but have **no checkout** as of 2026-08-05. An item filed against either routes nowhere until cloned — gate G1 refuses it.

## Build reality — the trap this domain exists to prevent

**`theo-cli` uses `npm`, not `pnpm`.** Measured: `package-lock.json` present, no `pnpm-lock.yaml`.

The umbrella's `CLAUDE.md` groups `theo-cli` with the six data-plane TS repos under a single "`pnpm test`" row. That is wrong, and it is the kind of wrong that produces a confident false measurement: `pnpm` resolves a different dependency graph than the lockfile pins, so a test run under the wrong manager tests something other than what ships.

```bash
cd theo-cli && npm test && npm run typecheck && npm run lint
cd theo-cli && task quality:all              # Taskfile also present — check `task --list`
cd theo-storage && go build ./... && go test ./... && go vet ./...
```

## `theo-storage` is embryonic — 21 commits

Calibrate accordingly. In a repo this young:

- **Missing features are not defects.** "There is no retry" is a design gap, not a bug, and filing it as one wastes the cycle.
- **A `review` finding needs a caller.** With almost no consumers, most orphan-looking code is simply unwritten-yet. The dead-code check matters more here than anywhere.
- The honest mode is usually `evolve` — measuring what the current shape costs — or nothing at all.

The umbrella's `CLAUDE.md` describes it as "1 commit". It has 21. Read the repo, not the description.

## What a real finding looks like

**`theo-cli`** sits between the developer and the platform, so its defects are experienced as *the platform being broken*:

- **Errors that surface a stack trace instead of a cause.** "Cannot read property of undefined" tells the user nothing about their misconfigured project.
- **Silent partial deploys.** A push that reports success while one step failed is the worst shape here — the user believes something shipped.
- **Credentials written to disk unprotected**, or logged in verbose mode. Never reproduce a value in an opportunity; record shape, location, lifetime.
- **Exit codes that lie.** A CLI returning 0 on failure breaks every script wrapping it.
- **Drift from the API's OpenAPI contract.** `theo-cli` talks to `theo/api` over HTTP; a contract change there lands here.

**`theo-storage`** — the six-operation contract (`upload/download/list/stat/delete/…`) must behave identically to the in-process vertical it mirrors. Divergence between the two is a real finding even this early.

## Before calling a review finding real

1. **Dead?** CLI subcommands are registered, not called — check the command registry before calling a handler orphaned.
2. **Caller never existed?** `git log -S`.
3. **Deliberate?** Check ADRs; CLI ergonomics often encode a deliberate trade-off.

## Blast radius heuristics

| Change in | Typically reaches |
|---|---|
| A CLI flag or its semantics | every script and CI pipeline invoking it — cross-repo in practice, even though nothing imports the CLI |
| Auth handling | `control-plane`, and every authenticated command |
| The API client | coupled to `theo/api` — an OpenAPI change is cross-repo |
| `theo-storage`'s six-operation contract | the in-process vertical it mirrors |

A CLI's consumers are **scripts and humans**, not importers. Grep finds nothing and the change still breaks everyone's pipeline — this domain's blast radius is systematically under-estimated for exactly that reason.

## Cycle contract

Read [`rules/cycle-discover.md`](../rules/cycle-discover.md) before measuring. Neither repo has a live browser surface — use `review`, `bug` or `evolve`. Evidence is `file:line` that resolves, with the line verified, and never a credential value.
