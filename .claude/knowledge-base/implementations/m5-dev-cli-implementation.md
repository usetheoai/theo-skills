---
slug: m5-dev-cli
milestone_id: M5
plan: knowledge-base/plans/m5-dev-cli-plan.md
completed_at: 2026-06-23
verdict: IMPLEMENTATION_COMPLETE
---

# M5 — CLI de dev local (lint/validate/test) — Implementation Summary

4 fases TDD. Estado final: typecheck PASS, lint 0/0, 194 testes verdes (core 55 + api 48+76 +
cli 13+2). Plan-confidence SHIPPABLE (100). deps-audit: 0 CVEs (só `yazl` nova dep de runtime).

## Phase 1 — Orquestrador compartilhado (commit 55613d7)

- `core/domain/skill-validation.ts` — `validateSkillPayload(buffer, {payloadValidator, secretScanner})
  → SkillValidationResult` (`{ok, name, description, frontmatter, validated}` | `{ok:false, code,
  message, details?}`). Sequência: zip-safety → frontmatter → secret. Resultado estruturado (não lança).
- `api/handlers/skills.ts::ingestPayload` refatorado para delegar ao orquestrador → **fonte única**
  (servidor e CLI). Testes M1 (e2e) verdes provam paridade de comportamento/códigos 400.

## Phase 2 — Subpath de adapters (commit c51c039)

- `api/src/validators.ts` re-exporta `createYauzlPayloadValidator` + `createSecretlintScanner`;
  `package.json#exports["./validators"]` (subpath leve — não importa hono/pg-boss). A CLI usa os
  MESMOS adapters do servidor (secret scan via secretlint consagrado — risco #2 fechado).

## Phase 3 — CLI (commit b2793a8)

- Pacote `@usetheo/skillregistry-cli` (bin `theoskill`). `node:util parseArgs` (sem dep de arg-parser).
- `args.ts` (parse validate/publish/help/unknown), `zip.ts` (`packageSkill`: dir/SKILL.md/.zip → zip yazl).
- `commands/validate.ts` — reusa `validateSkillPayload` + adapters; erros por regra; exit 0/1/2.
- `commands/publish.ts` — valida → empacota → GET decide POST (novo) ou PATCH (existente); `fetch`
  injetável; erros de rede claros; exit codes.
- `index.ts` — wira adapters reais + dispatch; auto-run só quando invocado como bin (guard ESM).

## Phase 4 — E2E (commit b2793a8)

- `api/src/testkit.ts` (`@usetheo/skillregistry-api/testkit`) — boota um registry in-process
  (app + workers create/update/delete) e expõe um `fetch`-shaped, sem vazar tipos pg/pg-boss/hono
  → permite o E2E cross-package da CLI sem essas deps.
- `cli-e2e.integration.test.ts` — validar (dir) → publicar → operação ACTIVE → `GET /v1/skills/:id`
  recupera; e publish UPDATE → PATCH (nova revisão). Contra Postgres + pg-boss reais.

## Decisões

- **DRY via orquestrador único no core** (ADR D1) — servidor e CLI chamam a MESMA função; sem
  divergência (risco ROADMAP #1 fechado).
- **Adapters via subpath leve do api** (ADR D2) — não move os arquivos de M1 (`payload/`); CLI leve.
- **parseArgs (stdlib)** (ADR D3) — zero dep de arg-parser (parsimony ladder).
- **publish POST/PATCH** decidido por GET /:id — reusa Create/Update (DoD).
- **testkit** exposto pelo api habilita o E2E cross-package sem acoplar a CLI a pg/pg-boss/hono.
- Única dep nova de runtime: `yazl` (escritor de zip; o servidor lê com yauzl).
