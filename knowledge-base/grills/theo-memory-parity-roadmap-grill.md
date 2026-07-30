---
slug: theo-memory-parity
date: 2026-07-30
generated_by: roadmap-init (REFUSED — pre-flight 0.1) → adaptado para extensão de roadmap
questions_answered: 4
unresolved_dims: []
status: completed
---

# Roadmap grill: theo-memory-parity

## Contexto da sessão

`/roadmap-init` foi invocado e **recusou** no pre-flight 0.1: `ROADMAP.md` já existe
(329 linhas, M0–M9, gerado por `roadmap-init` em 2026-06-22). O owner escolheu
explicitamente **inflar o roadmap existente com M10–M17**, ciente de que o Revision
protocol do próprio documento recomenda `ROADMAP-v2.md` para adições post-M8.

O grill foi **adaptado**: em vez de 4 perguntas × 8 milestones (32 turnos), 4 perguntas
de alto impacto que decidem o desenho do bloco inteiro.

## Levantamento que precedeu as perguntas

Achado que reorienta tudo: `theo-memory/docs/ARCHITECTURE.md` se declara **"Theo
Architecture Standard — canonical reference for every project in the Theo ecosystem.
All repos MUST conform. Deviations require an ADR."** Portanto o objetivo não é
"copiar técnicas do theo-memory" — é **conformar ao padrão da casa**, do qual o
theo-memory é a implementação de referência.

Gap medido em 2026-07-30:

| Dimensão | theo-memory | theo-skills |
|---|---|---|
| Pacotes | 6 (`agent-core` `api` `cli` `core` `eval` `mcp`) | 3 (`api` `cli` `core`) |
| Workflows CI | 8 | **0** |
| ADRs | 5 | 0 |
| LICENSE · SECURITY · CONTRIBUTING · CODE_OF_CONDUCT · NOTICE | ✓ | ✗ |
| ARCHITECTURE · RUNBOOK · benchmarks · `.mcp.json` | ✓ | ✗ |
| Auth (`AuthVerifier`, `Principal`, OIDC, API keys, scopes) | ✓ | ✗ |
| Multi-tenancy (`workspace_id` denormalizado, 404-não-403) | ✓ | ✗ |
| RBAC (`owner`/`admin`/`member`, last-owner, anti-escalation) | ✓ | ✗ |
| Rate limiting · OTel middleware | ✓ | ✗ |
| `Dockerfile` · `vitest.e2e.config.ts` | ✓ | ✗ |

Conforme ao padrão hoje: layout `contract/domain/infrastructure`, nomes
`@usetheo/skills*`, pnpm workspaces, ESLint 9 flat, Drizzle no pacote com acesso a DB.

Invariantes do theo-memory a herdar literalmente (lidos no código e no README):
`Principal` resolvido da credencial nunca do body · `workspace_id` primeiro em todo
`WHERE` · cross-tenant `404` nunca `403` · default-deny de papel · last-owner com
`SELECT … FOR UPDATE` · anti-escalation na cunhagem de chave · fail-closed `503` ·
legacy bridge para workspace `default` · teste de isolamento como hard gate contra
Postgres real.

### Q1/4: Sobreposição com milestones abertos

**Question:** M6 (RBAC granular) e M8 (hardening + OTel) já estão abertos e se sobrepõem
à paridade com o theo-memory, que já tem RBAC e OTel. Como resolver?

**Recommended:** Absorver M6 e M8 nos novos milestones, marcando-os `superseded` com
nota — evita dois milestones entregando a mesma coisa.

**User answer:** Absorver M6 e M8 nos novos.

### Q2/4: Modelo de tenancy e visibilidade

**Question:** Qual o modelo de isolamento e visibilidade das skills?

**Recommended:** `skillId` único por workspace (PK composta) + camada `public` de catálogo
curado incluída no retrieve — resolve o cold start de um tenant novo, e puxa
proveniência/assinatura junto porque skill pública carrega código executável.

**User answer:** workspace + público curado.

### Q3/4: Superfícies de consumo

**Question:** O theo-memory expõe `packages/mcp` e `packages/agent-core`. O theo-skills
deve ter os dois?

**Recommended:** Sim, dois milestones próprios — é o que torna o registry consumível por
agentes do jeito Theo, e o MCP é a porta que o `theo-traefik-mcp` já expõe por tenant.

**User answer:** MCP + SDK, dois milestones.

### Q4/4: Ordem de ataque

**Question:** Qual a ordem? Isso define quem é M10.

**Recommended:** CI primeiro. Com zero workflows, qualquer trabalho grande entra sem rede
de proteção; o theo-memory tem 8 workflows prontos para espelhar.

**User answer:** CI primeiro, depois auth.
