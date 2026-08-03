---
slug: m5-dev-cli
milestone_id: M5
created_at: 2026-06-23
generated_by: discover-execute
sources:
  - M1 validation primitives (core ports + api adapters): frontmatter.ts, payload-validator.ts, secret-scanner.ts, yauzl-validator.ts, secretlint-scanner.ts
  - server boundary orchestration: api/src/server/handlers/skills.ts::ingestPayload
  - node:util parseArgs (stdlib CLI args), yazl (zip writer)
---

# Blueprint: M5 — CLI de dev local (lint/validate/test)

## Problem

Dar aos autores de skills uma CLI que **valida a skill localmente antes do upload** (estrutura
`SKILL.md` + frontmatter Theokit + limites de payload + secret scan) com os **MESMOS checks** da
fronteira do servidor (DRY — regra única), e que **empacota e publica** no registry reusando a API
Create/Update. Diferencial que o Google Skill Registry não tem.

## Prior art (interno — M1)

A fronteira do servidor (`api/.../handlers/skills.ts::ingestPayload`) já orquestra os 4 checks em
sequência: **(1)** zip-safety (`PayloadValidator` → yauzl) → **(2)** frontmatter Theokit
(`parseFrontmatter`) → **(3)** secret scan (`SecretScanner` → secretlint). Os PORTS estão no
`core/domain`; os ADAPTERS (yauzl/secretlint) no `api`. Sem CLI na casa (theokit/theo-rag) — greenfield.

## Decisões de escopo (locked)

1. **DRY — orquestrador compartilhado no `core`** (mitiga risco #1 "divergência CLI vs servidor"):
   extrair a sequência dos 4 checks de `ingestPayload` para `core/domain/skill-validation.ts`
   (`validateSkillPayload(buffer, {payloadValidator, secretScanner}) → SkillValidationResult`). O
   servidor E a CLI chamam a MESMA função. Resultado estruturado (não lança) → CLI imprime erros
   claros por regra; servidor mapeia para HTTP 400.
2. **Adapters reusados via subpath leve do `api`**: `api/src/validators.ts` re-exporta
   `createYauzlPayloadValidator` + `createSecretlintScanner` (subpath `@usetheo/skillregistry-api/validators`
   — NÃO importa hono/pg-boss, mantém a CLI leve). A CLI usa os MESMOS adapters do servidor (risco #2
   "secret scan frágil" mitigado — secretlint consagrado, zero regex caseira).
3. **CLI sem deps de arg-parser**: `node:util parseArgs` (stdlib, parsimony ladder rung 2). Empacotamento
   via `yazl` (única dep nova da CLI; o servidor lê com yauzl, a CLI escreve com yazl). Publish via
   `fetch` global (stdlib).
4. **Comandos**: `theoskill validate <path>` (valida local; exit ≠0 + erros por regra) e
   `theoskill publish <path> --registry <url> --skill-id <id>` (valida → zip → POST /v1/skills, ou
   PATCH se já existe; imprime `operation_id`). Reusa Create/Update (DoD).

## Coverage Corner 1 — Integration Tests

- **Validate local**: dir com SKILL.md válido → `validate` OK; SKILL.md inválido (frontmatter ruim,
  segredo, zip-bomb) → erro por regra + exit ≠0.
- **Paridade CLI↔servidor**: a MESMA `validateSkillPayload` aprova/reprova os mesmos payloads que o
  servidor (mesmo orquestrador, mesmos adapters).
- **Publish E2E**: `publish` contra um registry local (createApp) → validate → POST → operation ACTIVE
  → `GET /v1/skills/:id` recupera a skill.
- **Publish update**: skill já existe → PATCH (nova revisão).
- **Erro de rede / registry indisponível**: `publish` falha com mensagem clara, exit ≠0.

## Coverage Corner 2 — Dependencies

| Dep | Onde | Papel | Risco |
|---|---|---|---|
| `yazl` ^3.3.1 | CLI | escrever o zip do payload (dir → zip) | maduro; já usado em tests da casa |
| (stdlib) `node:util parseArgs` | CLI | parse de args sem dep | — |
| (stdlib) `fetch` | CLI | publish HTTP | — |
| (reuso) `@usetheo/skillregistry` (core) | CLI | `validateSkillPayload` + ports | — |
| (reuso) `@usetheo/skillregistry-api/validators` | CLI | adapters yauzl/secretlint (mesmos do servidor) | subpath leve (sem hono/pg-boss) |

`/deps-audit` confirmará apenas `yazl` como nova dep de runtime.

## Coverage Corner 3 — Tools

- `node:util parseArgs` (subcommands + flags).
- `yazl` (zip writer) — espelha o `buildZipBase64` dos tests.
- `fetch` (publish) + poll de `GET /v1/operations/:id`.
- bin executável (`#!/usr/bin/env node`) + `bin` no package.json.

## Coverage Corner 4 — Techniques

- **DRY**: `validateSkillPayload` único no core; servidor e CLI o chamam (risco #1 fechado).
- **DIP**: a CLI injeta os adapters (yauzl/secretlint) na função do core — testável com stubs.
- **Resultado estruturado**: `SkillValidationResult` (ok | {code, message}) → renderização clara por
  regra na CLI; mapeamento HTTP no servidor.
- **Saída de erro acionável**: por arquivo/regra (ex.: `SKILL.md: frontmatter — name must be lowercase...`).
- **Exit codes**: 0 sucesso, ≠0 falha (scriptável em CI do autor).

## ADRs

### ADR D1 — Orquestrador compartilhado no core (não duplicar na CLI)
**Decisão**: `validateSkillPayload` no `core/domain`; servidor refatora `ingestPayload` para chamá-lo.
**Alternativa rejeitada**: reimplementar os checks na CLI (duplicação → divergência, risco #1).
**Consequência**: uma fonte de verdade; mudança de regra reflete em ambos.

### ADR D2 — Adapters via subpath leve do api (não mover payload/)
**Decisão**: `api/src/validators.ts` re-exporta os factories; CLI importa via subpath. Mantém os
adapters onde estão (M1) e a CLI leve (sem hono/pg-boss transitivos).
**Alternativa rejeitada**: mover yauzl/secretlint para o core (refactor maior dos arquivos de M1).
**Consequência**: a CLI depende do `api` só para os 2 factories; o subpath não puxa o runtime do servidor.

### ADR D3 — parseArgs (stdlib) em vez de commander/yargs
**Decisão**: `node:util parseArgs`. **Por quê**: parsimony ladder — stdlib resolve; zero dep de CLI.
**Consequência**: parsing simples (subcommand + flags); suficiente para validate/publish.

## Smells / riscos residuais

- **Divergência CLI↔servidor** (risco #1): fechado pelo orquestrador único + adapters compartilhados.
- **Secret scan frágil** (risco #2): fechado — secretlint (consagrado), nunca regex caseira.
- **Publish: skill existente** → PATCH; novo → POST. Detecção via GET /v1/skills/:id.
- **CLI puxa `api`**: aceitável (subpath leve); documentado.

## Verdict

SHIPPABLE_WITH_CAVEATS — reusa primitivos validados (M1) + stdlib; DRY garantido pelo orquestrador
único; riscos do ROADMAP mitigados na arquitetura. Pronto para `/to-plan`.
