# CLAUDE.md — theo-skills

The **theo-skills** module of the Theo platform.

> This file currently carries the platform-integration pointer below; add project-specific
> rules/contract above this line as the module matures.

## Integrating with the Theo platform (local live-test)

This is a module of the Theo platform. To develop it against the **live platform** and — if it
exposes an HTTP API — wire it into the unified edge as a capability (the way `theo-memory` is
`/v1/memory`), use the local-env umbrella in **theo-workspace**.

**Start here → `theo-workspace/docs/README.md`**
(repo `usetheodev/theo-workspace`; local sibling: `../../theo-cloud/theo-workspace`).

Read in order:

1. `docs/local-env-system-design.md` — where this module fits (a data-plane capability behind the Traefik edge; the engine is k8s-native and lives in the cloud).
2. `docs/ONBOARDING.md` — `make up-local` + `make memory-up` to bring the platform up and live-test in the browser. Per-role workflows + troubleshooting.
3. `docs/adding-a-microservice.md` — expose this module at the edge: **Level 1** (edge route, ~10 min, theo-workspace only) → **Level 2** (per-tenant Model B isolation, across theo-workspace + theo-cloud + this module's auth contract). **theo-memory is the reference implementation — copy it.**

Honest notes from the live validation (2026-06-25/26): run the control-plane with `make up-local`
(GHCR `:develop` is behind the current source); the LLM/provider is always the **real** API (no
mock); after editing `theo-workspace/dev/traefik/dynamic.yml` recreate traefik (single-file bind
mount + `watch:true` misses inode changes).
