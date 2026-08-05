# Security policy

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.** Use the private channel:

- **GitHub Security Advisories** — *Security* tab → *Report a vulnerability* on this repository.
- Or email **security@usetheo.dev** with `[theo-skills]` in the subject.

Include, where applicable: the affected version or commit, reproduction steps, observed impact,
and any evidence (log, request, payload). **Never include real credentials in the report** —
describe the shape, not the value.

Initial response within **72 business hours**. We coordinate disclosure with the reporter;
credit is given unless you ask otherwise.

## Scope

This repository is a **registry of agent skills**. The surfaces with the largest consequence:

| Surface | Why it matters |
|---|---|
| Payload validation (`packages/core/src/domain/payload-validator.ts`) | The package is a third party's zip: path traversal, symlinks, zip bombs and depth are stopped here |
| Secret scanning on upload | A skill published with an embedded credential leaks to everyone who downloads it |
| Executable content | Skills carry `scripts/`. Whoever consumes the registry **executes** that content |
| Webhooks | The URL is user-supplied — SSRF is a design risk, not a hypothesis |
| Version uniqueness | One semantic version resolves to exactly one revision. Without it, `^1.2.0` could return different bytes on different days |

## What is implemented today

Stated so you do not spend time reporting as missing what already exists — and test it instead.

- **Authentication.** API keys and OIDC, with scopes (`skills:publish` and the rest). Milestone
  M12 is closed; `THEOSKILL_AUTH_REQUIRED` governs enforcement, and the server logs loudly when
  it is off.
- **Per-workspace isolation.** `workspace_id` is part of the primary key of `skills` and
  `workspace_users`, and it leads every index. A cross-tenant read answers 404, not an empty
  list — the difference between the two would itself leak which identifiers are taken. M11 is
  closed.
- **RBAC and workspace members.** M13 is closed.
- **Rate limiting.** Present at the server boundary.

> This section replaced one that claimed there was **no** authentication, **no** multi-tenant
> isolation and **no** rate limiting, and told the reader not to expose the API publicly. All
> three had shipped (M11, M12, M13 are `[x]` in `ROADMAP.md`). A security policy that understates
> its own protections is not cautious — it tells a researcher those surfaces are not worth
> testing, which is exactly where you want them looking.

## Known limitations at this phase

Honest about the real state, so you do not report as a flaw what is a recorded decision.

- **Pre-1.0.** The public API surface may change between minor versions; see the CHANGELOG.
- **Dev-only transitive CVEs are tracked, not fixed** — issue #151: five HIGH advisories in
  development dependencies that never reach a published artifact.
- **Two skills carry a dangling `latest_revision_id`** (`sk_dog1`, `sk_dog2` — dogfood fixtures
  with zero revisions each). Harmless, and recorded rather than hidden.

## Supported versions

Pre-1.0: only the latest published version receives security fixes.
