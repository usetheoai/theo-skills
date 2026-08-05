---
slug: english-only-sweep
target_project: theo-skills
created_at: 2026-08-05
goal: Levar o repositório a zero ocorrências de PT-BR nas quatro superfícies, com portão que impede a regressão
---

# Plan: English-only sweep — remover PT-BR de código, contratos, saída e documentação

> **Version 1.1** — revisado em 2026-08-05 absorvendo os 9 MUST FIX de `knowledge-base/reviews/english-only-sweep-edge-cases-2026-08-05.md`. As mudanças de v1.0 → v1.1 estão listadas em `## Revision log`.
>
> O `/code-review` de 2026-08-05 verificou 10 achados. Nove são a mesma falha sistêmica exposta em camadas diferentes: português ainda embarca em descrições de ferramenta MCP lidas pelo modelo do agente, em corpos de erro HTTP/JSON-RPC, na saída da CLI, nos identificadores exportados de um pacote publicado no npm, nos nomes de job do CI que servem de *required status check*, e em toda a documentação operacional. O décimo (`assertPublishable` sem chamador) é um defeito de correção independente que a varredura descobriu por tabela. Este plano fecha os dez, **nesta ordem**: primeiro os guardas que a tradução destruiria em silêncio, depois o contrato público, depois o texto, e por último os comentários e a documentação — cada fase deixando a suíte verde.

## Goal

> Enable o repositório `theo-skills` a expor uma superfície monolíngue em inglês, de modo que nenhum identificador público, string de usuário/agente, comentário de código, documento ou nome de job de CI esteja em PT-BR, measured by `pnpm test:workflows` executando `tests/repo/language-gate.test.ts` com **0 violações** nas quatro tiers (A–D) e o arquivo de catraca `tests/repo/language-budget.json` zerado.

## Context

O `/code-review` de 2026-08-05 (49 agentes, esforço `high`) verificou 10 achados sobre a branch `workspace`. A instrução do usuário — "nosso sistema deve estar 100% em inglês e devemos remover qualquer comentário ou código em PT-BR" — **supersede explicitamente** a decisão registrada no CHANGELOG em `1f7cf99` (*"Comentários de código e identificadores internos permanecem como estão: são para quem mantém, não para quem usa"*). Aquela decisão traduziu apenas hints e mensagens de erro de handlers; o resto ficou.

O trabalho não é uma varredura de `sed`. Três achados mostram que traduzir **primeiro** quebra os próprios guardas que deveriam proteger a varredura:

1. `packages/mcp/tests/contract/bin.contract.test.ts:53` afirma `not.toContain('THEOSKILL_REGISTRY é obrigatório')`. Traduzir o produtor (`bin.ts:94`) torna a asserção **vacuamente verdadeira** — o teste fica verde e para de proteger.
2. `packages/core/src/index.ts:112` reexporta símbolos com nome em português como API pública de um pacote publicado no npm; `scripts/check-publish-artifacts.mjs` só confere se os arquivos declarados em `exports` chegam ao tarball — nunca compara a superfície de API. Renomear é breaking change indetectável.
3. `.github/workflows/ci.yml:98` — o `name:` do job `static` é o *contexto* do required status check. Renomear sem re-apontar a branch protection trava todo PR aberto.

O denominador medido hoje (comandos em `## Baseline Context`): **48** ocorrências de identificadores públicos em PT, **131** literais de string com acento em `src/` não-teste, **1554** linhas de comentário com acento, **15** nomes de job/step de CI, **3** descrições de pacote npm, **9** documentos e **2** nomes de arquivo.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `tests/repo/language-gate.test.ts` (NEW) | 0 | — | (a criar) — o portão de idioma | — |
| `tests/repo/language-budget.json` (NEW) | 0 | — | (a criar) — catraca por tier, só encolhe | — |
| `tests/repo/api-surface.test.ts` (NEW) | 0 | — | (a criar) — trava a superfície exportada | — |
| `tests/repo/core-api-surface.json` (NEW) | 0 | — | (a criar) — snapshot dos nomes exportados | — |
| `vitest.workflows.config.ts` | 14 | `2e7634a` (2026-08-03) | Config na raiz para alvos que não pertencem a pacote (`.github/**`, `Dockerfile`) | `include` de `tests/workflows/**` continua válido |
| `package.json` (raiz) | — | `2e7634a` (2026-08-03) | Scripts do workspace | `test:workflows` continua sendo o comando que o CI chama |
| `packages/mcp/tests/contract/bin.contract.test.ts` | 135 | `8b363d2` (2026-08-01) | Trava o fail-closed do boot do MCP | Continuar provando que o stdio sem credencial nomeia **só** `THEOSKILL_AUTH` |
| `packages/mcp/src/bin.ts` | 112 | `c236218` (2026-08-01) | Entrypoint do servidor MCP (stdio + streamable-HTTP) | `process.exit(2)` em toda recusa de boot |
| `packages/core/src/domain/discoverability.test.ts` | 209 | `65d877e` (2026-08-04) | Trava o diagnóstico de descobribilidade | Cardinalidade do rascunho (`toHaveLength(1)`, l.197) não regride |
| `packages/core/src/domain/discoverability.ts` | 146 | `65d877e` (2026-08-04) | Diagnóstico puro de descobribilidade (M34) | Vocabulário fechado `DISCOVERABILITY_CAUSES` (valores são contrato, não mudam) |
| `packages/core/src/index.ts` | 117 | `0462986` (2026-08-04) | Barrel do pacote publicado `@usetheo/skills` | Todo símbolo listado em `exports` continua resolvendo |
| `packages/core/src/domain/version.ts` | 160 | `90c8ed5` (2026-07-31) | SemVer, canais e `assertPublishable` | `compareVersions` / `resolveRange` mantêm semântica |
| `packages/core/src/domain/version.test.ts` | 123 | `90c8ed5` (2026-07-31) | Testa SemVer e `assertPublishable` | Casos de `duplicate` / `not_greater` continuam cobertos |
| `packages/core/src/infrastructure/db/schema.ts` | 473 | `d6392a0` (2026-08-03) | Schema Drizzle | Orçamento de 500 LoC — a mudança precisa caber em ~27 linhas |
| `packages/core/src/infrastructure/db/migrations/` (NEW .sql) | 0 | — | (a criar) — índice único de versão | Migração aditiva, nunca destrutiva |
| `packages/api/src/server/store/skills-store.ts` | 330+ | `d6392a0` (2026-08-03) | Persistência de skills e revisões | `insert(skillRevisions)` continua dentro da mesma transação |
| `packages/api/src/server/handlers/publishing.ts` | 230 | `1f7cf99` (2026-08-04) | Rotas de canais, bundles e tokens | Formato `{error, details}` do 400 não muda de forma |
| `packages/api/src/server/handlers/admin-keys.ts` | 97 | `1f7cf99` (2026-08-04) | Rotas de chaves administrativas | idem |
| `packages/api/src/server/handlers/platform-keys.ts` | 107 | `1f7cf99` (2026-08-04) | Rotas de chaves de plataforma | idem |
| `packages/api/src/server.ts` | 246 | `ab97df7` (2026-08-02) | Bootstrap do servidor + observabilidade de pool | Códigos de saída no boot |
| `packages/api/src/server/app.ts` | 200+ | `ab97df7` (2026-08-02) | Composição do app Hono | Costuras de teste (`embedder`, executor) continuam injetáveis |
| `packages/mcp/src/tools.ts` | 172 | `b8da764` (2026-08-04) | As 4 ferramentas MCP | `error: 'not_found'` continua sendo o **código** para skill ausente |
| `packages/mcp/src/server.ts` | 85 | `7273fca` (2026-07-31) | Servidor MCP | — |
| `packages/mcp/src/transports/streamable-http.ts` | 310 | `75eea74` (2026-08-01) | Transporte streamable-HTTP | Códigos JSON-RPC não mudam |
| `packages/mcp/tests/contract/tools.contract.test.ts` | 183 | `b8da764` (2026-08-04) | Contrato das ferramentas MCP | — |
| `packages/cli/src/commands/install.ts` | 220 | `5876b35` (2026-07-31) | `theo-skills install` | Integridade sha256 continua abortando **antes** de escrever |
| `packages/cli/src/commands/update.ts` | 110 | `e6dbbe2` (2026-08-01) | `theo-skills update` | — |
| `packages/cli/src/index.ts` | 122 | `fbe6f05` (2026-07-31) | Parser de argumentos da CLI | — |
| `packages/sdk/src/client.ts` | 182 | `b8da764` (2026-08-04) | Cliente HTTP do SDK | `SkillsApiError` mantém `status` |
| `packages/sdk/src/remote-skills-manager.ts` | 134 | `004c705` (2026-07-31) | Carga remota de instruções | `degraded` continua observável |
| `packages/api/eval/discoverability-dataset.json` | 25 | `50ec38a` (2026-08-04) | Dataset do eval de descobribilidade | `query` e `expect_skill_id` são os únicos campos lidos pelo runner |
| `packages/api/eval/run-discoverability.ts` | 124 | `50ec38a` (2026-08-04) | Runner do eval | Skill ausente do acervo é reportada e **não** conta regressão |
| `.github/workflows/ci.yml` | 157 | `2e7634a` (2026-08-03) | Gate rápido | Build antes de Lint (travado por `gates.test.ts:27`) |
| `.github/workflows/{actionlint,build-publish,integration,publish-npm,publish,security-sast}.yml` | — | vários | Demais gates | `gates.test.ts` casa `/smoke/i` e `/build \+ push/i` em `build-publish.yml` |
| `packages/{cli,mcp,sdk}/package.json` | — | vários | Manifestos publicados no npm | `exports`/`types`/`bin` intocados |
| `README.md` · `CONTRIBUTING.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md` · `PRD.md` | 253/80/42/—/390 | vários | Docs de topo | Links internos continuam resolvendo |
| `docs/ARCHITECTURE.md` · `docs/RUNBOOK.md` · `docs/credential-rotation.md` · `docs/integracao-theokit-mcp.md` | 82/85/68/112 | vários | Docs operacionais | idem |
| `Dockerfile` | — | vários | Runtime da API + worker | Major do Node igual ao do `ci.yml` (travado por `gates.test.ts`) |
| `packages/api/tests/integration/m28-execution-nao-confiavel.integration.test.ts` | — | — | Teste de integração M28 | Continuar sendo casado por `vitest.integration.config.ts` |
| `CHANGELOG.md` | 2360+ | `88d4fa4` (2026-08-04) | Contrato público de mudanças | Entradas já publicadas NUNCA são editadas (Regra 6) |

### Current callers / dependents

- **Símbolo:** `diagnosticarDescobribilidade()` em `packages/core/src/domain/discoverability.ts:100`
  - **Callers (produção):** reexportado por `packages/core/src/index.ts:112` (`export *`) → consumido pelo handler de autoria da API
  - **Callers (testes):** `packages/core/src/domain/discoverability.test.ts`
  - **External (API pública consumida por outros repos):** **sim** — `@usetheo/skills` é publicado no npm (`.github/workflows/publish-npm.yml`). Junto com ele saem `Diagnostico`, `EntradaDiagnostico`, `EstadoDaRevisao`, `CandidataVizinha` e os campos `revisao`/`vizinhas`/`similaridade`/`publicada`/`temVetor`.

- **Símbolo:** `assertPublishable()` em `packages/core/src/domain/version.ts:101`
  - **Callers (produção):** **NENHUM** — medido com `grep -rn 'assertPublishable' --include='*.ts' packages/`; só `version.test.ts` e o `dist/*.d.ts` compilado.
  - **Callers (testes):** `packages/core/src/domain/version.test.ts:4,56,58,59,65,75,83`
  - **External:** sim (reexportado via `index.ts:115`).

- **Símbolo:** `versionsOf()` em `packages/api/src/server/store/channels-store.ts:28`
  - **Callers (produção):** `packages/api/src/server/handlers/publishing.ts:44`, `packages/api/src/server/app.ts:160`
  - **External:** não.

- **Símbolo:** inserção de revisão — `tx.insert(skillRevisions)` em `packages/api/src/server/store/skills-store.ts:295` (criação) e `:314` (`addRevision`)
  - Ambos gravam `version` direto do input; nenhum consulta versões existentes antes.
  - `packages/core/src/infrastructure/db/schema.ts:175-179` declara **um** índice (`skill_revisions_ws_skill_create_idx`), não-único.

- **Símbolo:** nome do job `static` em `.github/workflows/ci.yml:97-98`
  - **Callers (testes):** `tests/workflows/gates.test.ts:26` lê `jobs.static.steps` — usa a **chave** `static`, não o `name:`. O rename do `name:` não quebra o teste.
  - **External:** o `name:` É o contexto do required status check na branch protection do remoto — fora do repositório.

### Domain glossary

- **acervo** — o conjunto de skills publicadas visíveis a um workspace; o que a busca por intenção percorre.
- **revisão** — snapshot imutável de uma skill (ADR-3); nunca sofre `UPDATE`. Vetor é propriedade da revisão, não da skill.
- **canal** — ponteiro nomeado (`stable`, `beta`) de uma skill para uma revisão.
- **descobribilidade** — a skill é achada pela intenção que deveria encontrá-la; distinta de validade.
- **tier de superfície** — neste plano, a classe de exposição de um texto PT: A = identificador público, B = string lida por usuário/agente, C = comentário de código, D = documentação/metadado.
- **catraca (ratchet)** — arquivo de orçamento por tier cujo valor só pode encolher; permite o portão entrar verde antes de a varredura terminar.

### Architecture boundaries affected

- **`rules/architecture.md` § 1 (camadas)** — `packages/core/src/domain/**` é a camada interna; nenhuma tarefa deste plano faz o domínio importar infraestrutura. A tarefa T4.1 mantém a inversão: o domínio expõe `assertPublishable`, e o *store* (infra) é quem o chama.
- **`rules/architecture.md` § 3 (API pública é o contrato — minimize)** — a fase 2 **renomeia** a superfície exportada de `@usetheo/skills`; o snapshot em `tests/repo/core-api-surface.json` passa a ser o registro explícito desse contrato, que hoje não existe.
- **`rules/testing.md` § 5 (pareamento de teste)** — os novos testes de repo ficam em `tests/repo/`, alcançados por `vitest.workflows.config.ts`, seguindo o precedente de `tests/workflows/` (alvos que não pertencem a pacote nenhum).
- **`rules/error-handling.md` § 2 (erros explícitos e tipados)** — a fase 3 separa **código** (estável, para máquina) de **mensagem** (legível, para humano) no campo `error` do MCP, que hoje mistura os dois.

## Prior Art & Related Work

- **Blueprint interno** — `knowledge-base/discoveries/blueprints/m32-skill-lifecycle-blueprint.md`: precedente de vocabulário fechado como contrato (`SKILL_LIFECYCLES`), que este plano reusa ao decidir que os **valores** de `DISCOVERABILITY_CAUSES` são contrato e não são traduzidos, só os identificadores e o texto ao redor.
- **Precedente no próprio repositório** — commit `1f7cf99` (*feat(i18n)*) traduziu hints e mensagens tipadas dos handlers. Este plano estende o mesmo movimento às superfícies que aquele commit deixou de fora, e o achado 6 do review é exatamente a metade que ficou.
- **Precedente de portão auto-verificante** — `tests/workflows/gates.test.ts` + `vitest.workflows.config.ts` (M10): a suíte que trava invariantes de arquivos que não pertencem a pacote. O portão de idioma é o mesmo padrão aplicado a outro invariante; não inventa mecanismo novo (parsimônia rung 4).
- **Precedente de gate de artefato** — `scripts/check-publish-artifacts.mjs` recusa publicar manifesto que promete arquivo ausente do tarball (issues #115/#116). O gate de superfície de API da fase 1 é o irmão que faltava: aquele olha *quais arquivos* chegam; este, *quais nomes*.
- **Patterns skills** — `ls .claude/skills/*-patterns/` → nenhuma existe neste repositório. Nada a consumir nem a sobrepor.
- **Referências clonadas** — `knowledge-base/references/` não contém projeto pertinente a i18n de superfície. (nenhuma citada)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `vitest` | `^4.0.0` | npm (dev) | O portão de idioma e o de superfície de API são testes Vitest, alcançados pela config de raiz já existente (D1 — parsimônia rung 4) |
| `yaml` | `^2.9.0` | npm (dev) | Leitura de `.github/workflows/*.yml` no tier D; já é como `tests/workflows/gates.test.ts` faz |
| `typescript` | `^5.4.0` | npm (dev) | `pnpm typecheck` no DoD e o emit do `.d.ts` que T1.3 snapshota |
| `eslint` | `^9.0.0` | npm (dev) | `pnpm lint` no DoD de toda tarefa |
| `typescript-eslint` | `^8.0.0` | npm (dev) | idem, regras type-aware |
| `node:fs` · `node:path` · `node:child_process` | stdlib (Node 20+) | node | Varredura de arquivos e as chamadas `git merge-base` / `git show` da catraca (rungs 2–3 da escada de parsimônia) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | Avaliadas e **rejeitadas** em D1/D3: regra ESLint customizada (só enxerga o grafo TS/JS — não veria `ci.yml`, `SECURITY.md`, `Dockerfile` nem nomes de arquivo, que são 4 dos 10 achados); `@microsoft/api-extractor` (dependência pesada para o que `fs` + um JSON resolvem); lib de detecção estatística de idioma (recall marginal sobre frases sem acento ao custo de uma dependência nova — a normalização NFD + lista de radicais cobre o caso real) | Nenhuma nova é necessária: a escada de parsimônia para na rung 4 (reusar `vitest`/`yaml` já declarados) para os dois portões, e nas rungs 2–3 (stdlib) para a varredura |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

**Exposição a CVE** — auditado em 2026-08-05, relatório em `knowledge-base/audits/english-only-sweep-deps-audit-2026-08-05.md`. Nenhuma das seis linhas acima tem CVE na versão declarada. Existem 5 HIGH em dependências **transitivas de desenvolvimento** sob `eslint` e `vitest` (`brace-expansion`, `js-yaml`, `postcss`): não alcançam artefato publicado, mas são reais e ficaram rastreadas em issue própria. O único achado de produção (`@hono/node-server` MODERATE, transitivo sob `@modelcontextprotocol/sdk`) é pré-existente, não é tocado por este plano, e vive na issue #126.

## Objective

- [ ] O portão de idioma existe, roda no CI e reprova quando PT-BR reaparece em qualquer tier.
- [ ] Os guardas que a tradução destruiria (asserção negativa por literal; cardinalidade de hints; superfície de API) são independentes de idioma **antes** de qualquer tradução.
- [ ] Nenhum identificador exportado por `@usetheo/skills`, `@usetheo/skills-sdk`, `@usetheo/skills-mcp` ou pela CLI está em português, e o rename saiu numa release cujo bump declara a quebra.
- [ ] Nenhuma string lida por usuário ou por modelo de agente (MCP, CLI, HTTP `details`, SDK) está em português; o campo `error` do MCP carrega **código**, e a mensagem legível vai em campo próprio.
- [ ] `assertPublishable` é chamado no caminho de publicação e o banco tem índice único em `(workspace_id, skill_id, version)`.
- [ ] Nenhuma linha de comentário em `packages/*/src/**` está em português.
- [ ] Documentação, nomes de job/step de CI, descrições de pacote e nomes de arquivo estão em inglês, com a branch protection re-apontada no mesmo passo do rename dos jobs.

## ADRs

### D1 — O portão é um teste de repositório, não uma regra de ESLint

- **Decisão:** implementar o portão de idioma como um teste Vitest em `tests/repo/language-gate.test.ts`, alcançado ao estender o `include` do `vitest.workflows.config.ts` já existente.
- **Rationale:** os alvos atravessam linguagens de arquivo — `.ts`, `.yml`, `.json`, `.md`, `Dockerfile`, e até *nomes de arquivo*. Reusa `vitest` + `node:fs`, ambos já instalados (parsimônia rung 4); zero dependência nova. Segue o precedente de `tests/workflows/gates.test.ts`, que existe pela mesma razão (`rules/architecture.md` § 3 — coesão por responsabilidade, não por tipo).
- **Alternativas consideradas:**
  - *Regra ESLint customizada* — **rejeitada:** ESLint só enxerga o grafo de módulos TS/JS. Não veria `ci.yml`, `SECURITY.md`, `Dockerfile` nem nomes de arquivo — que são 4 dos 10 achados.
  - *`grep` num step de CI* — **rejeitada:** sem catraca, ou entra reprovando (bloqueia o repo até a varredura acabar) ou entra permissivo (não é portão). E não é executável localmente pelo mesmo comando que o dev já roda.
  - *Revisão humana no PR* — **rejeitada:** o achado 4 é a prova empírica de que guarda por convenção decai sem ser notada.
- **Consequências:** habilita entregar em fases com CI verde; cria um arquivo de orçamento que precisa ser mantido honesto (mitigação em `## Drawbacks`).

### D2 — O portão classifica por tier de superfície, não por presença de acento

- **Decisão:** quatro tiers com regra própria — **A** identificadores exportados, **B** literais de string alcançáveis por usuário/agente, **C** linhas de comentário, **D** docs, metadados de pacote, nomes de job/step de CI e nomes de arquivo.
- **Rationale:** uma regra única "nenhum acento no repositório" produz falso positivo em conteúdo que é legitimamente PT — o dataset de eval mede um acervo real em português (D5), e um teste de unicode pode precisar de acento como dado. Tier separado permite carve-out justificado sem desligar o portão inteiro. `rules/error-handling.md` § 2: o portão precisa falhar **claro** — dizer *qual tier* e *qual arquivo*, não "achei acento".
- **Alternativas consideradas:**
  - *Regra única por acento* — **rejeitada:** confunde dado com código, e o primeiro falso positivo faz alguém desligar o portão.
  - *Detecção estatística de idioma (lib externa)* — **rejeitada:** dependência nova (rung 4 falha) para ganhar recall sobre frases sem acento; a heurística de acento + lista de palavras-função cobre o caso real, e o custo do falso negativo aqui é uma linha esquecida, não um defeito de produção.
- **Consequências:** o portão é honestamente **heurístico** — reporta isso na própria saída; frases PT sem acento e sem palavra-função escapam.

### D3 — A superfície pública é renomeada de uma vez, travada por snapshot, e sai como breaking

- **Decisão:** renomear os identificadores em português exportados e travar a superfície em **dois níveis** — `tests/repo/core-api-surface.json` (lista de nomes) e `tests/repo/core-api-surface.d.ts` (conteúdo do `.d.ts` emitido). A release que carrega o rename declara a quebra no CHANGELOG sob `Removed`/`Changed`.
- **Rationale:** hoje nada compara superfície de API; `check-publish-artifacts.mjs` só confere presença de arquivo. Sem snapshot, esta classe de quebra volta na próxima renomeação. **Dois níveis porque um só não basta:** a lista de nomes não enxerga rename de campo, e T2.1 renomeia cinco campos de interfaces exportadas — a quebra que mais atinge o consumidor seria justamente a invisível (EC-5 do relatório de edge cases). Ambos os artefatos são versionados para que a mudança de contrato apareça **no diff do PR**, que é onde a decisão pertence.
- **Alternativas consideradas:**
  - *Aliases de deprecação (`export { diagnoseDiscoverability as diagnosticarDescobribilidade }`)* — **rejeitada:** mantém o nome PT na superfície publicada por tempo indefinido, contradizendo o Goal; e adia a quebra sem eliminá-la.
  - *`@microsoft/api-extractor`* — **rejeitada:** dependência pesada para uma necessidade de uma lista de nomes; rung 4/5 da escada de parsimônia resolvem com `fs` + um JSON.
  - *Renomear só o que a API expõe, deixar tipos internos* — **rejeitada:** `export *` não distingue; todo tipo do módulo já É público.
- **Consequências:** consumidores no `^x.y` quebram no `tsc`; exige nota de migração no CHANGELOG. Ganha-se um portão que faltava desde sempre.

### D4 — Guardas acopladas a idioma são convertidas para asserções independentes de idioma ANTES da tradução

- **Decisão:** trocar `not.toContain('THEOSKILL_REGISTRY é obrigatório')` por `not.toContain('THEOSKILL_REGISTRY')` (o nome da variável, que não se traduz) e adicionar guarda de cardinalidade aos três ramos de hint ainda descobertos — **na fase 1**, antes de qualquer string mudar.
- **Rationale:** uma asserção negativa sobre um literal traduzível não falha quando o produtor muda; ela simplesmente para de significar algo. A janela entre traduzir e consertar o teste é uma janela sem proteção — e `rules/testing.md` § 6 nomeia exatamente isto ("testes que testam implementação em vez de comportamento").
- **Alternativas consideradas:**
  - *Traduzir e ajustar os testes depois* — **rejeitada:** é a janela vacua descrita acima; e um teste verde não sinaliza que precisa de ajuste.
  - *Asserção sobre código de saída apenas* — **rejeitada:** perde o comportamento que o teste protege (nomear **só** a variável faltante).
- **Consequências:** a fase 1 não entrega valor visível ao usuário; entrega a rede sob as fases seguintes.

### D5 — As *queries* do dataset de eval permanecem em português, com carve-out datado

- **Decisão:** traduzir os campos de *código* do eval (chaves `_note`/`_acervo`/`_honestidade`/`_envelhecimento`/`_why`; identificadores `existe`/`esperada` em `run-discoverability.ts`), e **manter em português as `query` dos casos**, registrando o carve-out no tier D do portão com sunset em **2026-11-05** e issue própria.
- **Rationale:** as queries medem recall contra um acervo **real** cujas descrições estão em português (`redteam-cambio-1785615135`, `revisar-contrato`, `auditar-dependencias-m33` — medido em app-dev em 2026-08-04, ver o campo `_honestidade` do dataset). Traduzir a consulta sem traduzir o conteúdo do acervo compara uma intenção em inglês com uma descrição em português e derruba o recall — o portão passaria a reportar **regressão de produto onde só houve mudança de idioma da pergunta**. O dado não vive neste repositório; a correção honesta é migrar o acervo primeiro.
- **Alternativas consideradas:**
  - *Traduzir as queries agora* — **rejeitada:** transforma o gate de descobribilidade num gerador de falso alarme, e o time aprende a ignorá-lo — o mesmo modo de falha que `discoverability.ts:78-80` descreve para detectores ruidosos.
  - *Desligar o eval até o acervo migrar* — **rejeitada:** perde a proteção contra regressão real de descoberta durante todo o período.
- **Consequências:** o repositório não fica literalmente 100% sem português no dia da entrega — há **3 strings de query** de dado de teste, declaradas, datadas e com issue. Isto está registrado em `## Unresolved Questions` Q1 para decisão explícita do usuário.

### D6 — Unicidade de versão: guarda no domínio **e** índice único no banco

- **Decisão:** chamar `assertPublishable` no caminho de publicação (`skills-store.ts`) **e** criar índice único em `(workspace_id, skill_id, version)` com `version IS NOT NULL`.
- **Rationale:** os dois cobrem falhas diferentes. A guarda de domínio produz erro **tipado** (`VersionRejectedError` com `reason: 'duplicate' | 'not_greater'`) que o handler mapeia para 409 com causa legível — `rules/error-handling.md` § 2. O índice cobre a corrida entre dois publishes concorrentes, que a guarda sozinha não vê: ler-depois-escrever fora de uma restrição do banco é TOCTOU. Índice parcial porque revisões pré-M19 têm `version NULL` legítimo (`schema.ts:167-168`).
- **Alternativas consideradas:**
  - *Só o índice* — **rejeitada:** devolve violação de constraint crua; o publisher recebe 500 sem saber que republicou uma versão existente.
  - *Só a guarda* — **rejeitada:** dois `POST` simultâneos passam ambos pela leitura antes de qualquer escrita.
  - *Constraint `CHECK`* — **rejeitada:** `CHECK` não enxerga outras linhas.
- **Consequências:** a migração pode **falhar** se já existirem duplicatas em produção; exige consulta de detecção antes de aplicar (T4.2, e `## Failure scenarios`).

### D7 — O rename dos jobs de CI e a re-configuração da branch protection são um passo único e coordenado

- **Decisão:** renomear todos os `name:` de job/step em `.github/workflows/*.yml` num único commit, e re-apontar os *required status checks* na mesma janela, com verificação por comando antes e depois.
- **Rationale:** o contexto do required check é o `name:` do job quando presente. Renomear sem re-apontar deixa a proteção exigindo um contexto que nunca mais será reportado — todo PR aberto trava sem saída, que é o modo de falha já registrado na memória do projeto (`required-check-vs-paths-ignore`).
- **Alternativas consideradas:**
  - *Renomear os jobs e ajustar a proteção depois* — **rejeitada:** a janela entre os dois é exatamente o travamento.
  - *Remover o `name:` e deixar a chave do job virar o contexto* — **rejeitada:** troca um contexto por outro do mesmo jeito, e ainda piora a legibilidade da lista de checks.
- **Consequências:** a tarefa depende de permissão de admin no remoto, fora do repositório — declarada como pré-condição da T6.2 e como risco.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Renomear a superfície de `@usetheo/skills` quebra consumidores no `^x.y`; npm não permite unpublish após 72h | **Alta** | Snapshot de API (T1.3) torna a quebra visível no PR; bump major explícito; nota de migração no CHANGELOG antes do publish; T2.1 lista os consumidores conhecidos e o usuário confirma antes do merge | Owner do pacote |
| Renomear jobs de CI trava todo PR aberto se a branch protection não for re-apontada na mesma janela | **Alta** | D7 — passo único; T6.2 verifica os contextos por `gh api` antes e depois, **e propaga `develop` para cada PR aberto** (passo 7 do procedimento), porque PRs que ramificaram antes do rename reportam os contextos antigos e ficariam bloqueados sem saída | Admin do repo |
| A catraca do portão fica **sem efeito** quando a base não é resolvível (fork sem `origin/develop`, execução local em branch órfã) | **Média** | O portão emite aviso explícito e a ausência do aviso reprova o teste (`ratchet_skips_loudly_when_base_unresolvable`); a comparação nunca é declarada feita quando não foi | Portão (T0.1) |
| Índice único em `(workspace_id, skill_id, version)` pode falhar ao aplicar se já houver duplicata em produção | **Alta** | T4.2 roda a consulta de detecção **antes** de gerar a migração e reporta as linhas; a migração só entra depois de a contagem ser 0 ou de haver decisão explícita sobre as duplicatas existentes | DBA / Owner |
| Traduzir 1554 linhas de comentário é um diff enorme, difícil de revisar e propenso a perder o *porquê* que esses comentários carregam | **Média** | Fase 5 é por pacote, um commit por pacote, e **só** comentários (nenhuma linha de código no mesmo commit) — o `--stat` fica auditável; a regra é traduzir preservando o raciocínio, nunca resumir | Implementador |
| A catraca (`language-budget.json`) pode ser afrouxada por engano, tornando o portão decorativo | **Média** | O próprio teste falha se um valor do orçamento **subir** em relação ao commit anterior (comparado com `git show HEAD:tests/repo/language-budget.json`) | Portão (T1.1) |
| O portão é heurístico: PT sem acento e sem palavra-função escapa | **Baixa** | Declarado na saída do portão e nesta tabela; falso negativo custa uma linha esquecida, não um defeito de produção — preferimos isso a falso positivo, que faz o time desligar o portão | Portão (T1.1) |
| O carve-out do eval (D5) deixa 3 strings PT no repositório na data da entrega | **Baixa** | Sunset 2026-11-05 + issue; declarado no tier D e em `## Unresolved Questions` Q1 | Owner |

## Unresolved Questions

- Q1 — O carve-out de D5 (3 `query` em português no dataset de eval, porque medem um acervo real em português) é aceitável, ou o usuário prefere migrar o acervo do app-dev primeiro e só então traduzir as queries? **Bloqueia a T6.3.**
- Q2 — Quais consumidores externos de `@usetheo/skills` existem hoje? `grep` cross-repo não é possível daqui; o rename de D3 precisa dessa lista para a nota de migração. Se a resposta for "nenhum fora do workspace", o bump pode ser minor em vez de major. **Bloqueia a T2.1.**
- Q3 — Existe duplicata de `(workspace_id, skill_id, version)` no banco de produção hoje? Medível só com acesso ao banco; a T4.2 roda a consulta, mas a decisão sobre o que fazer com as linhas encontradas é do owner. **Bloqueia a T4.2.**
- Q4 — `gh api repos/.../branches/*/protection` não resolve deste checkout (o remoto usa o host alias `github-usetheo` e o `gh` não o reconhece). Quem tem admin confirma os contextos exigidos hoje antes da T6.2?
- Q5 — O CHANGELOG deste repositório está inteiramente em português. Ele entra no tier D (traduzir o arquivo inteiro) ou fica de fora, por ser registro histórico que a Regra 6 proíbe reescrever? **Bloqueia a T6.1.**

## Dependency Graph

```
Phase 0 (portão + catraca)
   │
   ▼
Phase 1 (guardas independentes de idioma)  ◀── PRÉ-REQUISITO DE TUDO QUE TRADUZ
   │
   ├──────────────┬──────────────┬─────────────────┐
   ▼              ▼              ▼                 ▼
Phase 2       Phase 3        Phase 4          Phase 6
(API pública) (strings)   (unicidade de     (docs, CI,
   │              │        versão — NÃO      metadados)
   │              │        depende da              │
   │              │        tradução)               │
   └──────┬───────┘              │                 │
          ▼                      │                 │
     Phase 5 (comentários)  ◀────┘                 │
          │                                        │
          └────────────────┬───────────────────────┘
                           ▼
              Final Phase: Integration Validation
```

**Paralelizáveis:** Phase 2, Phase 3, Phase 4 e Phase 6 não se tocam (arquivos disjuntos) — podem correr em paralelo depois da Phase 1.
**Sequenciais obrigatórios:** Phase 0 → Phase 1 → (qualquer fase que traduza). Phase 5 por último entre as de tradução, porque seu diff é o maior e conflitaria com as demais.

---

## Phase 0: O portão de idioma

**Objective:** existir um comando que mede a dívida de PT-BR por tier, entra no CI verde, e impede que ela cresça.

### T0.1 — Portão de idioma com catraca por tier

#### Objective
Criar `tests/repo/language-gate.test.ts` + `tests/repo/language-budget.json` e alcançá-los pelo runner de repositório já existente.

#### Why this step (action + reasoning — ReAct discipline)

**O que este passo faz:** implementa um teste que varre o repositório, classifica cada ocorrência de PT-BR em um dos quatro tiers de D2, compara a contagem com um arquivo de orçamento versionado e falha quando algum tier **cresce**.

**Por que agora e não depois:** sem catraca, o portão só pode entrar no fim — e um portão que entra no fim nunca protegeu nada durante o trabalho, que é justamente quando o risco de regressão é máximo. A catraca permite que ele entre **primeiro** e que cada fase seguinte o aperte. Motivado por D1 e pelo achado 4 do review, que demonstra empiricamente que guarda por convenção decai sem ninguém perceber.

#### Evidence
- `vitest.workflows.config.ts:9-12` — `include: ['tests/workflows/**/*.test.ts']`; a config existe exatamente para alvos que não pertencem a pacote nenhum (comentário nas linhas 4-7).
- `package.json` (raiz) — `"test:workflows": "vitest run --config vitest.workflows.config.ts"`; `.github/workflows/ci.yml:156-157` já executa esse script.
- Baseline medido em 2026-08-05: tier A = 48 ocorrências; tier B = 131 literais em 44 arquivos; tier C = 1554 linhas; tier D = 15 nomes de CI + 3 descrições de pacote + 9 docs + 2 nomes de arquivo.
- `packages/core/src/domain/discoverability.ts:78-80` — precedente do próprio código sobre preferir silêncio a ruído num detector heurístico.

#### Files to edit
```
tests/repo/language-gate.test.ts      (NEW) — o portão
tests/repo/language-budget.json       (NEW) — orçamento por tier, semeado com o baseline medido
vitest.workflows.config.ts            — estender `include` com 'tests/repo/**/*.test.ts'
package.json                          — renomear o script para `test:repo` mantendo `test:workflows` como alias
.github/workflows/ci.yml              — `fetch-depth: 0` no checkout do job `static` (EC-2)
```

#### Deep file dependency analysis
- `vitest.workflows.config.ts` (Baseline: 14 LoC, `2e7634a`) — hoje inclui só `tests/workflows/**`. A mudança adiciona **um** elemento ao array `include`; `tests/workflows/gates.test.ts` continua sendo coletado exatamente como antes.
- `package.json` — `ci.yml:157` chama `pnpm run test:workflows`. Manter o alias evita alterar o workflow nesta fase (o rename dos steps é T6.2, e misturar as duas coisas acopla um risco alto a um risco baixo).
- Nenhum arquivo de `packages/**` é tocado: o portão é read-only sobre a árvore.

#### Deep Dives
- **Estrutura do orçamento:** `{ "tierA": 48, "tierB": 131, "tierC": 1554, "tierD": 29, "carveOuts": [...] }`. Cada `carveOut` tem `path`, `tier`, `reason`, `sunset` (ISO date) e `issue`.
- **Normalização, ANTES de qualquer casamento (EC-3):** todo texto candidato passa por `.normalize('NFD').replace(/\p{M}/gu, '')`. Sem isto o matcher só vê português **acentuado**, e os dois arquivos que a T6.1 renomeia — `docs/integracao-theokit-mcp.md` e `m28-execution-nao-confiavel.integration.test.ts` — não têm um acento sequer: o portão reportaria `tierD = 0` com eles intactos, declarando sucesso sobre trabalho não feito. A lista de palavras-função é escrita já sem acento e casada contra o texto normalizado, e inclui os radicais frequentes deste repositório: `nao|sem|dos|das|para|com|uma|que|integracao|execucao|versao|configuracao|dependencias|invariantes|descobrib|producao|declaradas|banco|imagem|arquivo|usuario`.
- **Detecção por tier** (todas sobre o texto normalizado):
  - **A** — nomes em `export`/`export *` resolvidos a partir dos barrels (`packages/*/src/index.ts`), casados contra a lista de palavras-função PT e contra acentos.
  - **B** — literais de string em `packages/*/src/**/*.ts` (excluindo `*.test.ts`).
  - **C** — linhas cujo `trim()` comece com `//`, `*` ou `/*`.
  - **D** — `name:` em `.github/workflows/*.yml`; `description` em `packages/*/package.json`; `.md` de topo e de `docs/`; nomes de arquivo rastreados pelo git.
- **Invariante da catraca — a base é o merge-base, NUNCA `HEAD` (EC-1):** o teste lê o orçamento anterior de `git show $(git merge-base origin/develop HEAD):tests/repo/language-budget.json`. Ler de `HEAD` seria inútil no único lugar onde a catraca importa: em evento `pull_request` o `actions/checkout@v4` faz checkout do **merge commit** (verificado em `ci.yml:113`, sem `ref:`), então `HEAD` **já contém as mudanças do PR** e o "orçamento anterior" seria o do próprio PR — subir `tierB` de 131 para 140 declarando 140 passaria nas duas asserções. Regras: se qualquer tier for **maior** que o da base, falha; se for menor, exige que o arquivo em disco tenha sido atualizado (senão a dívida encolheu e o orçamento mentiu para cima).
- **Pré-condição do checkout (EC-2):** `merge-base` exige histórico. O `ci.yml:113` usa o default `fetch-depth: 1` — `grep -rn 'fetch-depth' .github/workflows/` só encontra `publish.yml:46`. Sem `fetch-depth: 0` no job `static`, corrigir a EC-1 troca falha silenciosa por **crash** em todo PR. Quando a base não for resolvível (fork sem `origin/develop`, execução local em branch órfã), o teste aceita `PR_BASE_SHA` do ambiente e, na ausência dos dois, **pula a comparação com aviso explícito** — nunca a declara feita.
- **Carve-out expirado:** um `carveOut` com `sunset` no passado é **ignorado** — as ocorrências voltam a contar. Mesmo desenho do allowlist de `code-quality-golden-rule.md` § 4.
- **Carve-out com `sunset` inválido é REJEITADO, nunca interpretado (EC-4):** `Date.parse('em breve')` é `NaN`, e toda comparação com `Invalid Date` devolve `false` — inclusive `sunset < now`. Interpretado, o carve-out seria classificado como não-expirado **para sempre**, e um erro de digitação viraria bypass permanente e silencioso do único mecanismo de exceção do portão. O parser lança na entrada malformada, como `code-quality-golden-rule.md` § 4 faz com `allowlist_malformed_entry`.
- **Edge cases:** primeiro commit / base indisponível → comparação pulada com aviso (acima); arquivo binário → ignorado; caminho rastreado mas ausente do disco (checkout esparso, `git mv` interrompido) → pulado por `try/catch` **por arquivo**, com os pulados listados na saída, em vez de abortar a varredura inteira (EC-18); `node_modules`, `dist`, `.claude/knowledge-base/references` → fora do escopo.

#### Pseudo-code / Signatures

```pseudocode
function fold(s: string): string
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()   -- EC-3

function scanRepository(): Record<Tier, Violation[]>
  -- Violation = { tier, path, line, excerpt, reason }
  for each tracked file (git ls-files), skipping ignored roots:
    try: text = read(file)
    catch ENOENT: record skipped(file); continue                   -- EC-18
    classify by extension and location -> candidate tiers
    for each candidate tier: collect violations matching fold(text)
  return grouped

function baseBudget(): Budget | null                               -- EC-1 / EC-2
  base = git merge-base origin/develop HEAD      || env.PR_BASE_SHA || null
  if base === null: warn('base unavailable — ratchet NOT enforced this run'); return null
  return parse(git show `${base}:tests/repo/language-budget.json`)

function parseCarveOut(c): CarveOut                                -- EC-4
  if Number.isNaN(Date.parse(c.sunset)): throw Error(`carve-out ${c.path}: invalid sunset '${c.sunset}'`)
  if (c.issue ?? '') === '':             throw Error(`carve-out ${c.path}: missing issue`)
  return c

test 'language budget only shrinks':
  current  = scanRepository()
  budget   = read('tests/repo/language-budget.json')   -- carve-outs parsed via parseCarveOut
  previous = baseBudget()
  for tier in [A,B,C,D]:
    if previous !== null: assert count(current[tier]) <= previous[tier]   -- catraca
    assert budget[tier] == count(current[tier])                            -- orçamento não mente

# Example
input:  tierB has 129 violations; budget says 131; base said 131
output: FAIL — "tierB shrank to 129 but budget still declares 131; update the budget file"
```

#### Tasks
1. Criar `tests/repo/language-gate.test.ts` com `fold()`, os quatro matchers, `parseCarveOut()` e a catraca contra o merge-base.
2. Rodar o scanner uma vez e gravar o resultado em `tests/repo/language-budget.json`.
3. Estender `include` em `vitest.workflows.config.ts`.
4. Adicionar `test:repo` ao `package.json`, mantendo `test:workflows` como alias.
5. Alterar o checkout do job `static` em `ci.yml` para `with: { fetch-depth: 0 }`.
6. Rodar `pnpm run test:repo` e confirmar verde com o baseline semeado.

#### TDD
```
RED:     gate_fails_when_a_tier_grows() — semeia um orçamento com tierB=130 contra 131 reais; espera falha nomeando o tier
RED:     gate_fails_when_budget_overstates_debt() — orçamento diz 200, real é 131; espera falha pedindo atualização
RED:     gate_ignores_expired_carve_out() — carve-out com sunset em 2020; a ocorrência volta a contar
RED:     gate_reports_path_and_line() — a mensagem de falha contém path:line, não só a contagem
RED:     ratchet_reads_merge_base_not_head() — [EC-1] num repo-fixture cujo HEAD é um merge commit que JÁ sobe o orçamento, o portão FALHA (com HEAD como base, passaria)
RED:     ratchet_skips_loudly_when_base_unresolvable() — [EC-2] sem `origin/develop` e sem PR_BASE_SHA, o teste passa MAS emite o aviso; a ausência do aviso reprova
RED:     detector_matches_unaccented_portuguese() — [EC-3] `docs/integracao-theokit-mcp.md` e `m28-execution-nao-confiavel...` são contados no tier D
RED:     carve_out_with_invalid_sunset_is_rejected() — [EC-4] `sunset: 'em breve'` lança erro nomeando o carve-out; NÃO é tratado como não-expirado
RED:     carve_out_without_issue_is_rejected() — [EC-4] entrada sem `issue` lança
RED:     gate_fails_clearly_when_budget_is_malformed() — [EC-12] JSON inválido produz mensagem com o caminho do arquivo e a instrução de regeneração, não SyntaxError cru
RED:     gate_skips_missing_file_without_aborting() — [EC-18] caminho rastreado e ausente do disco é pulado e listado na saída; a varredura continua
GREEN:   Implementar scanner + normalização + catraca até os onze passarem
REFACTOR: Extrair os matchers por tier para funções nomeadas; nenhum arquivo acima de 500 LoC
VERIFY:  pnpm run test:repo
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `pnpm run test:repo` verde com o baseline semeado
- [ ] `pnpm run test:workflows` continua coletando `tests/workflows/gates.test.ts` (contagem de testes ≥ a de antes)
- [ ] A mensagem de falha nomeia tier + `path:line` + o motivo
- [ ] A saída do portão contém a palavra `heuristic` — `pnpm run test:repo` imprime a ressalva; a ausência dela reprova o teste `gate_declares_heuristic_nature`
- [ ] A catraca lê o **merge-base**, nunca `HEAD` — provado pelo fixture de `ratchet_reads_merge_base_not_head`
- [ ] O checkout do job `static` usa `fetch-depth: 0`
- [ ] O tier D conta os dois arquivos com nome em PT **sem acento**: `language-budget.json` declara `tierD.filenames = 2`, e `assert tierD.filenames === 2` no teste `detector_matches_unaccented_portuguese`
- [ ] Carve-out com `sunset` ou `issue` inválidos é **rejeitado**, não interpretado
- [ ] Pass: lint — `pnpm lint` retorna exit code 0
- [ ] Pass: size — `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] Tarefas 1–5 concluídas
- [ ] `pnpm test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] `pnpm lint` sem warnings
- [ ] CHANGELOG `[Unreleased] § Added` atualizado

---

## Phase 1: Os guardas que a tradução destruiria

**Objective:** tornar independente de idioma toda asserção que hoje depende de um literal em português, **antes** que qualquer literal mude.

### T1.1 — Asserção do boot do MCP deixa de depender do literal PT

#### Objective
Substituir `not.toContain('THEOSKILL_REGISTRY é obrigatório')` por uma asserção que sobrevive à tradução.

#### Why this step (action + reasoning)

**O que este passo faz:** troca a asserção negativa por `not.toContain('THEOSKILL_REGISTRY')` — o nome da variável de ambiente, que não é traduzível — e adiciona uma asserção positiva sobre a variável que **deve** aparecer.

**Por que agora:** achado 4 do review. Enquanto a asserção citar a frase em português, traduzir `bin.ts:94` a torna vacuamente verdadeira e o teste passa a proteger nada. Este é o único guarda do comportamento "nomear só a variável faltante", e ele precisa estar em pé antes da fase 3.

#### Evidence
- `packages/mcp/tests/contract/bin.contract.test.ts:53` — `expect(stderr).not.toContain('THEOSKILL_REGISTRY é obrigatório')`.
- `packages/mcp/src/bin.ts:90-96` — o `faltando` é montado com `.join(' e ')` e interpolado em `${faltando} é obrigatório`; traduzir muda tanto o conector quanto o sufixo.
- Review 2026-08-05, achado 4, verdict CONFIRMED.

#### Files to edit
```
packages/mcp/tests/contract/bin.contract.test.ts — asserções independentes de idioma
```

#### Deep file dependency analysis
- `bin.contract.test.ts` (Baseline: 135 LoC, `8b363d2`) — hoje testa três recusas de boot. Só o caso da linha 49-54 muda. `bin.ts` **não** é tocado nesta tarefa: o produtor é traduzido na fase 3, e é justamente essa ordem que a tarefa existe para garantir.
- Nenhum downstream: o arquivo é um teste de contrato, ninguém o importa.

#### Deep Dives
- **Invariante preservado (Baseline `bin.contract.test.ts`):** "o stdio sem credencial nomeia **só** `THEOSKILL_AUTH`". A asserção nova o expressa diretamente: `THEOSKILL_AUTH` presente, `THEOSKILL_REGISTRY` ausente — sem depender de uma única palavra da mensagem.
- **Edge case:** se algum dia a mensagem passar a citar `THEOSKILL_REGISTRY` num contexto legítimo (ex.: "using THEOSKILL_REGISTRY=http://..."), a asserção falha corretamente e força a decisão — o que é o comportamento desejado de um guarda.

#### Tasks
1. Extrair a linha de erro do stderr (`stderr.split('\n').find(l => l.startsWith('theo-skills mcp:'))`) e asseverar sobre ela, não sobre o buffer inteiro (EC-15).
2. Trocar a asserção da linha 53 por `expect(errLine).not.toContain('THEOSKILL_REGISTRY')`.
3. Adicionar comentário curto explicando por que a asserção não cita a frase.
4. Confirmar que o teste ainda passa contra o `bin.ts` **em português** (prova de independência de idioma).

#### TDD
```
RED:     Rodar o teste alterado contra um bin.ts com a mensagem traduzida à mão (stash local) — deve PASSAR
RED:     Rodar o teste alterado contra um bin.ts que (injetado) cita as duas variáveis — deve FALHAR
RED:     assertion_is_scoped_to_the_error_line() — [EC-15] com uma linha de diagnóstico extra no stderr ecoando `THEOSKILL_REGISTRY=...`, o teste continua PASSANDO; asseverar sobre o buffer inteiro o reprovaria sem regressão de comportamento
GREEN:   Nenhuma implementação de produção necessária; a mudança é o próprio teste
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/skills-mcp test
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhuma asserção em `bin.contract.test.ts` cita palavra em português da mensagem de erro
- [ ] O teste passa tanto com o `bin.ts` atual (PT) quanto com uma tradução experimental
- [ ] Pass: lint — `pnpm lint` retorna exit code 0
- [ ] Pass: size — `wc -l` ≤ 500 no arquivo alterado

#### DoD
- [ ] `pnpm --filter @usetheo/skills-mcp test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

### T1.2 — Cardinalidade de hints travada nos três ramos ainda descobertos

#### Objective
Estender a guarda de duplicação de `65d877e` — hoje presente só no ramo de rascunho — aos ramos `description_too_generic`, `no_embedding` e `collides_with_sibling`.

#### Why this step (action + reasoning)

**O que este passo faz:** adiciona `toHaveLength(n)` e `new Set(hints).size === hints.length` aos casos que hoje asseveram só presença.

**Por que agora:** achado 7. O defeito que `65d877e` corrigiu foi um merge que reintroduziu um bloco inteiro de hint, produzindo dois hints — um traduzido e outro em português — para o mesmo caso. `toContain` é indiferente a duplicata. A fase 5 mexe em **todos** os blocos de comentário deste arquivo, e é exatamente aí que um merge pode repetir a façanha; a guarda precisa existir antes.

#### Evidence
- `packages/core/src/domain/discoverability.test.ts:197` — `expect(d.hints).toHaveLength(1)` e `:199` — `expect(new Set(d.hints).size).toBe(d.hints.length)`; ambas só no bloco do rascunho.
- `packages/core/src/domain/discoverability.test.ts:31,58,70,145,156,170` — os demais casos usam apenas `toContain`/`toMatch`.
- `packages/core/src/domain/discoverability.test.ts:187` — comentário do próprio commit de fix: *"assertavam PRESENÇA (`toContain`, `toMatch`), e presença é indiferente à duplicata"*.
- `packages/core/src/domain/discoverability.ts:107,117,130,140` — os quatro `hints.push`.

#### Files to edit
```
packages/core/src/domain/discoverability.test.ts — guardas de cardinalidade nos três ramos restantes
```

#### Deep file dependency analysis
- `discoverability.test.ts` (Baseline: 209 LoC, `65d877e`) — a mudança acrescenta asserções aos `describe` existentes; nenhuma é removida. O arquivo continua abaixo de 500 LoC.
- `discoverability.ts` **não** muda nesta tarefa. Se alguma asserção nova falhar contra o código atual, isso é um defeito preexistente e deve ser reportado, não acomodado.

#### Deep Dives
- **Invariante:** para cada entrada, `hints.length` é exatamente o número de causas disparadas (ou 1 no caso do rascunho sem causa). Duplicata é sempre defeito.
- **Edge case (caso combinado, l.156-158):** duas causas simultâneas → `toHaveLength(2)` e conjunto sem repetição. É o caso que mais se beneficia da guarda, porque é onde um push duplicado se esconde melhor.

#### Pseudo-code / Signatures
```pseudocode
-- padrão aplicado a cada caso COM causa
const d = diagnoseDiscoverability(input)
expect(d.causes).toContain(EXPECTED_CAUSE)          -- já existe
expect(d.hints).toHaveLength(d.causes.length)        -- NOVO — vale só quando causes.length > 0
expect(new Set(d.hints).size).toBe(d.hints.length)   -- NOVO

-- EXCEÇÃO (EC-11): o ramo do rascunho tem 0 causas e 1 hint (discoverability.ts:139-143).
-- A fórmula acima é FALSA ali; mantém-se o literal já existente em discoverability.test.ts:197.
expect(d.causes).toHaveLength(0)
expect(d.hints).toHaveLength(1)

# Example
input:  { description: 'short', revision: {published:true, hasVector:false}, neighbours: [] }
output: causes = [DESCRIPTION_TOO_GENERIC, NO_EMBEDDING]; hints.length === 2; no duplicates
```

#### Tasks
1. Adicionar as duas asserções ao caso `description_too_generic`.
2. Idem ao caso `no_embedding`.
3. Idem ao caso `collides_with_sibling`.
4. Idem ao caso combinado (duas causas).
5. Adicionar o caso **máximo**, com as três causas simultâneas (EC-10).
6. Confirmar que o ramo do rascunho conserva o literal `toHaveLength(1)` — a fórmula `causes.length` não se aplica ali (EC-11).
7. Rodar e confirmar que nenhuma falha (se falhar, abrir issue: é defeito preexistente).

#### TDD
```
RED:     Injetar um hints.push duplicado em discoverability.ts localmente; os 5 casos devem FALHAR
RED:     all_three_causes_yield_exactly_three_unique_hints() — [EC-10] descrição curta + publicada sem vetor + vizinha ≥ 0.90: causes.length === 3, hints.length === 3, sem repetição
RED:     draft_with_no_cause_has_zero_causes_and_one_hint() — [EC-11] trava a exceção à fórmula; aplicar `toHaveLength(causes.length)` aqui quebraria o teste de 65d877e
GREEN:   Reverter a injeção; os 5 casos passam
REFACTOR: Extrair um helper `expectNoDuplicateHints(d, n)` se o padrão se repetir 4x (DRY — regra de 3)
VERIFY:  pnpm --filter @usetheo/skills test
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Os quatro ramos de `hints.push` têm guarda de cardinalidade, **mais** o caso máximo de três causas simultâneas
- [ ] Um `hints.push` duplicado injetado faz **cada** um dos cinco casos falhar
- [ ] O ramo do rascunho conserva `toHaveLength(1)` com `causes.length === 0` (a fórmula geral não se aplica ali)
- [ ] Pass: lint — `pnpm lint` retorna exit code 0
- [ ] Pass: size — `wc -l` ≤ 500 no arquivo alterado

#### DoD
- [ ] `pnpm --filter @usetheo/skills test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

### T1.3 — Snapshot da superfície de API pública

#### Objective
Criar `tests/repo/api-surface.test.ts` + os snapshots para que qualquer mudança na superfície publicada — **nome exportado ou campo de tipo exportado** — apareça no diff do PR.

#### Why this step (action + reasoning)

**O que este passo faz:** captura a superfície publicada em **dois níveis**: a lista de nomes exportados pelos barrels, e o conteúdo do `.d.ts` emitido. Compara ambos com artefatos versionados.

**Por que agora:** achado 1. A fase 2 **vai** renomear essa superfície, e sem o snapshot a quebra é indetectável — `check-publish-artifacts.mjs` só confere presença de arquivo, nunca de nome. O portão precisa existir antes da mudança que ele deveria ter capturado, não depois; caso contrário o snapshot nasce já registrando o estado pós-quebra e nunca terá provado nada.

#### Evidence
- `packages/core/src/index.ts:110-116` — seis `export *`, cada um expondo todo o módulo.
- `scripts/check-publish-artifacts.mjs:22-45` — `declaredEntryPoints()` percorre `types`/`main`/`bin`/`exports` e checa **caminhos**; nenhum nome de símbolo é lido.
- `.github/workflows/publish-npm.yml:82` — step *"portão de artefato — manifesto vs tarball"* é o único gate antes do publish.
- `packages/core/dist/index.d.ts` existe e contém 18 linhas com `export` — evidência de que a superfície compilada é derivável sem ferramenta nova.

#### Files to edit
```
tests/repo/api-surface.test.ts    (NEW) — compara superfície real vs snapshot (nomes + .d.ts)
tests/repo/core-api-surface.json  (NEW) — nomes exportados por @usetheo/skills
tests/repo/sdk-api-surface.json   (NEW) — nomes exportados por @usetheo/skills-sdk
tests/repo/core-api-surface.d.ts  (NEW) — cópia versionada do dist/index.d.ts emitido (EC-5)
```

#### Deep file dependency analysis
- Ambos os JSON são novos e versionados; o teste é read-only sobre `packages/*/src/index.ts`.
- `vitest.workflows.config.ts` já foi estendido em T0.1 para coletar `tests/repo/**` — nenhuma mudança de config aqui (dependência declarada: T0.1 antes de T1.3).
- `packages/sdk/src/index.ts:1-3` exporta 3 linhas nomeadas (sem `export *`) — o parser precisa lidar com as duas formas.

#### Deep Dives
- **Dois níveis, porque um só não cobre o que a Fase 2 faz (EC-5).** A lista de nomes NÃO enxerga rename de **campo**: trocar `revisao` por `revision` dentro de `EntradaDiagnostico` deixa a lista de exports idêntica, e T2.1 renomeia **cinco campos** exatamente assim. Um consumidor TypeScript que construa esse objeto quebra no `tsc`, e o snapshot de nomes passaria verde — a garantia que D3 e a Coverage Matrix (#1) atribuem a esta tarefa não existiria. Por isso o segundo nível: uma cópia versionada do `dist/index.d.ts`, comparada por conteúdo.
- **Por que o `.d.ts` completo e não um hash:** um hash detecta a mudança mas não a mostra. O valor do artefato é o **diff legível no PR** — nome antigo removido, nome novo adicionado, campo a campo. Um hash transformaria a revisão em "o número mudou, confie".
- **Ordem de execução:** o teste do `.d.ts` exige `pnpm build` antes; o teste de nomes lê o fonte e não exige. Quando `dist/index.d.ts` não existir, o teste do segundo nível **falha pedindo o build** — nunca é pulado em silêncio.
- **Resolução de `export *`:** o teste segue o `from './x.js'`, abre `x.ts` e coleta os `export` de topo. Profundidade 2 é suficiente para a árvore atual (medida); além disso, falha explicitamente pedindo extensão, em vez de silenciar.
- **Invariante:** o JSON é ordenado alfabeticamente, para que o diff de um rename mostre uma remoção e uma adição, não um embaralhamento.
- **Edge case:** `export type` vs `export` de valor — ambos entram na lista, marcados com `kind`, porque quebrar um tipo quebra o `tsc` do consumidor exatamente como quebrar um valor.
- **Edge case (JSDoc):** o `tsc` preserva JSDoc no `.d.ts`. A Fase 5 traduz comentários e **vai** alterar legitimamente este snapshot — é esperado, e o diff dirá que só a prosa mudou (ver EC-14 em T5.x).

#### Pseudo-code / Signatures
```pseudocode
function publicSurface(barrelPath: string): {name: string, kind: 'value'|'type'}[]
  entries = []
  for each export statement in barrel:
    if named export      -> push names
    if `export * from M` -> entries += publicSurface(resolve(M))   -- depth <= 2, else throw
  return sorted unique entries

test 'core public surface matches snapshot':
  assert publicSurface('packages/core/src/index.ts') deepEquals read('core-api-surface.json')

# Example
input:  index.ts has `export * from './domain/version.js'`
output: [..., {name:'assertPublishable',kind:'value'}, {name:'SemVer',kind:'type'}, ...]
```

#### Tasks
1. Implementar `publicSurface()` com resolução de `export *` até profundidade 2.
2. Gerar e commitar `core-api-surface.json` e `sdk-api-surface.json` com o estado **atual** (ainda em PT).
3. Rodar `pnpm build` e commitar `tests/repo/core-api-surface.d.ts` como cópia do `dist/index.d.ts` (EC-5).
4. Escrever os dois testes de igualdade (nomes e conteúdo do `.d.ts`).
5. Adicionar ao `check-publish-artifacts.mjs` (ou ao workflow `publish-npm.yml`) a execução de `pnpm run test:repo` antes do publish.

#### TDD
```
RED:     surface_test_fails_when_a_symbol_is_renamed() — renomeia um export local; espera falha nomeando o símbolo removido e o adicionado
RED:     surface_test_fails_when_a_symbol_is_added() — adiciona um export; espera falha
RED:     surface_resolver_throws_beyond_depth_2() — barrel encadeado 3 níveis; espera erro explícito, nunca lista parcial silenciosa
RED:     dts_snapshot_fails_when_an_exported_FIELD_is_renamed() — [EC-5] renomeia `revisao` -> `revision` em EntradaDiagnostico: a lista de NOMES continua idêntica (prova documentada no log) e o teste do .d.ts FALHA. Sem este caso, a garantia de D3 não existe
RED:     dts_snapshot_fails_loudly_when_dist_is_missing() — sem `pnpm build`, o teste falha pedindo o build; nunca é pulado
GREEN:   Implementar o resolver, a comparação de nomes e a comparação do .d.ts
REFACTOR: None expected
VERIFY:  pnpm build && pnpm run test:repo
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Renomear qualquer export de `packages/core/src/domain/**` faz o teste falhar nomeando o símbolo
- [ ] Renomear um **campo** de tipo exportado faz o teste do `.d.ts` falhar — com evidência de que o teste de nomes, sozinho, passaria
- [ ] Os snapshots commitados refletem o estado **pré-rename**: `grep -c diagnosticarDescobribilidade tests/repo/core-api-surface.json` retorna 1
- [ ] `publish-npm.yml` executa o portão antes de publicar
- [ ] Pass: lint — `pnpm lint` retorna exit code 0
- [ ] Pass: size — `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] `pnpm run test:repo` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Added` atualizado

---

## Phase 2: A superfície pública

**Objective:** nenhum identificador exportado por um pacote publicado está em português, e a quebra está declarada.

### T2.1 — Renomear os identificadores públicos em português

#### Objective
Renomear `diagnosticarDescobribilidade`, `Diagnostico`, `EntradaDiagnostico`, `EstadoDaRevisao`, `CandidataVizinha` e os campos `revisao`/`vizinhas`/`similaridade`/`publicada`/`temVetor`, atualizando o snapshot de T1.3.

#### Why this step (action + reasoning)

**O que este passo faz:** aplica o rename em `discoverability.ts`, nos seus consumidores, nos testes, e regenera `core-api-surface.json`.

**Por que agora e não junto com os comentários:** o rename é uma **quebra de contrato** e precisa de um diff pequeno e legível para revisão e para a nota de migração. Misturá-lo com a tradução de 1554 linhas de comentário (fase 5) tornaria impossível revisar a quebra. Motivado por D3 e pelo achado 1.

**Bloqueado por Q2** — a lista de consumidores externos determina se o bump é major ou minor.

#### Evidence
- `packages/core/src/domain/discoverability.ts:31,52,56,63,100` — as cinco declarações exportadas em português.
- `packages/core/src/index.ts:112` — `export * from './domain/discoverability.js'`.
- Medição 2026-08-05: 48 ocorrências dos identificadores em PT em `packages/*/src`.
- `packages/core/src/domain/version.ts:101,107` — `assertPublishable(next, existentes)` e a variável `maior`: o parâmetro `existentes` também é superfície (aparece no `.d.ts`).

#### Files to edit
```
packages/core/src/domain/discoverability.ts       — renomear tipos, função e campos
packages/core/src/domain/discoverability.test.ts  — acompanhar o rename
packages/core/src/domain/version.ts               — parâmetro `existentes` -> `existing`; `maior` -> `highest`
packages/core/src/domain/version.test.ts          — acompanhar
packages/api/src/server/handlers/discoverability.ts — consumidor do diagnóstico (linhas 76-87)
tests/repo/core-api-surface.json                  — regenerar após o rename
tests/repo/core-api-surface.d.ts                  — regenerar após o rename (EC-5)
CHANGELOG.md                                       — nota de migração sob [Unreleased]
```

#### Deep file dependency analysis
- `discoverability.ts` (Baseline: 146 LoC, `65d877e`) — renomeia declarações; o **vocabulário fechado** `DISCOVERABILITY_CAUSES` e seus **valores** (`'description_too_generic'`, …) NÃO mudam: são contrato de dados já consumido pela tela de autoria.
- `core-api-surface.json` — o diff mostrará 5 remoções e 5 adições; é exatamente a evidência que T1.3 existe para produzir.
- `version.ts` (Baseline: 160 LoC, `90c8ed5`) — só nomes de parâmetro/variável local; a assinatura posicional não muda, então nenhum chamador quebra além do `.d.ts`.

#### Deep Dives
- **Mapa de rename:**
  - `diagnosticarDescobribilidade` → `diagnoseDiscoverability`
  - `Diagnostico` → `DiscoverabilityReport`
  - `EntradaDiagnostico` → `DiscoverabilityInput`
  - `EstadoDaRevisao` → `RevisionState`
  - `CandidataVizinha` → `NeighbourCandidate`
  - campos: `revisao` → `revision`; `vizinhas` → `neighbours`; `similaridade` → `similarity`; `publicada` → `published`; `temVetor` → `hasVector`
- **Invariante (Baseline `discoverability.ts`):** a união discriminada permanece uma união — `{published:false} | {published:true, hasVector:boolean}`. O estado "não publicada e com vetor" continua irrepresentável; foi a correção do #144 e não pode ser desfeita por descuido de rename.
- **O contrato JSON NÃO é afetado — verificado, não presumido (EC-17).** `packages/api/src/server/handlers/discoverability.ts:89-96` devolve `c.json({ ...diagnostico, embedder })`, e os campos de `Diagnostico` (`discoverable`, `causes`, `hints`) **já estão em inglês**. Os cinco campos renomeados pertencem a `EntradaDiagnostico`, construída no servidor a partir do corpo snake_case (`body.has_embedding`, linhas 76-80) e **nunca serializada**. Consequência prática: a quebra é exclusivamente TypeScript, o `theo-cloud/dashboard` não é afetado, e **ninguém deve "corrigir" o wire format por precaução** — mexer nele seria a única quebra real de consumidor nesta tarefa.
- **Edge case:** `packages/core/dist/**` é artefato de build; não é editado à mão. Um `dist` velho com nomes antigos é normal até o próximo build — mas o snapshot `.d.ts` de T1.3 exige `pnpm build` antes da verificação.

#### Tasks
1. Renomear as cinco declarações e os cinco campos em `discoverability.ts`.
2. Atualizar `discoverability.test.ts`.
3. Renomear `existentes`/`maior` em `version.ts` + teste.
4. Atualizar os consumidores em `packages/api/src/server/handlers/`.
5. Rodar `pnpm build`, regenerar `core-api-surface.json` **e** `core-api-surface.d.ts`, e revisar os dois diffs nome a nome / campo a campo.
6. Escrever a nota de migração no CHANGELOG (tabela nome-antigo → nome-novo, tipos **e** campos).

#### TDD
```
RED:     api_surface_snapshot_mismatch() — o teste de nomes de T1.3 FALHA após o rename dos TIPOS e antes de regenerar o snapshot
RED:     dts_snapshot_mismatch_on_field_rename() — [EC-5] o teste do .d.ts FALHA após o rename dos CAMPOS; registrar no log que o teste de nomes passou verde no mesmo commit — é a evidência de que o segundo nível era necessário
RED:     discoverability_union_still_discriminated() — `{published:false, hasVector:true}` NÃO compila (teste de tipo via @ts-expect-error)
RED:     http_response_shape_unchanged() — [EC-17] POST ao endpoint de descobribilidade devolve exatamente as mesmas chaves de antes (`discoverable`, `causes`, `hints`, `embedder`) e continua lendo `has_embedding` do corpo
GREEN:   Aplicar o rename; regenerar os dois snapshots
REFACTOR: None expected — rename puro, sem mudança de comportamento
VERIFY:  pnpm --filter @usetheo/skills test && pnpm build && pnpm run test:repo
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `grep -rnE '(diagnosticarDescobribilidade|Diagnostico|EntradaDiagnostico|EstadoDaRevisao|CandidataVizinha)' packages/*/src` retorna 0
- [ ] **Os dois** testes de superfície falharam antes de os snapshots serem regenerados — o de nomes no rename dos tipos, o do `.d.ts` no rename dos campos (evidência colada no log de implementação)
- [ ] Os **valores** de `DISCOVERABILITY_CAUSES` permanecem idênticos
- [ ] O corpo JSON da resposta de descobribilidade é idêntico ao de antes (chaves e formato de entrada `has_embedding`)
- [ ] CHANGELOG traz a tabela de migração nome-antigo → nome-novo: `grep -c '| \`' CHANGELOG.md` cobre as 5 linhas de tipo e as 5 de campo
- [ ] Pass: lint / size — `pnpm lint` sem warnings e `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] `pnpm test` verde; `pnpm typecheck` sem erros; `pnpm lint` sem warnings
- [ ] `pnpm run test:repo` verde com tier A = 0
- [ ] CHANGELOG `[Unreleased] § Changed` com a quebra declarada

---

### T2.2 — Descrições dos pacotes publicados

#### Objective
Traduzir o campo `description` de `packages/{cli,mcp,sdk}/package.json`.

#### Why this step (action + reasoning)

**O que este passo faz:** troca três strings que aparecem na página do npm.

**Por que agora:** é superfície publicada como os identificadores, e cabe no mesmo PR do rename — dois arquivos de manifesto, diff trivial. Achado 10.

#### Evidence
- `packages/cli/package.json` — `"CLI do theo-skills — publicar, instalar e atualizar skills de agentes."`
- `packages/mcp/package.json` — `"Servidor MCP do theo-skills — descoberta e carga de skills por agentes (stdio e streamable-HTTP)."`
- `packages/sdk/package.json` — `"SDK do theo-skills — descoberta e obtenção de skills, com binding de workspace."`
- `packages/{api,core}/package.json` — sem `description` (nada a fazer).

#### Files to edit
```
packages/cli/package.json — description
packages/mcp/package.json — description
packages/sdk/package.json — description
```

#### Deep file dependency analysis
- Somente o campo `description`. `exports`, `types`, `bin` e `files` são intocados — `check-publish-artifacts.mjs` os lê e qualquer alteração ali é um modo de falha separado (issues #115/#116).

#### Deep Dives
- **Invariante:** nenhum outro campo do manifesto muda; o diff de cada arquivo é exatamente 1 linha.

#### Tasks
1. Traduzir as três descrições.
2. Rodar `node scripts/check-publish-artifacts.mjs` e confirmar que segue verde.

#### TDD
```
RED:     language_gate_tier_D_counts_package_descriptions() — o portão de T0.1 conta as 3 descrições; após a tradução a contagem cai para 0
GREEN:   Traduzir; atualizar o orçamento
REFACTOR: None expected
VERIFY:  pnpm run test:repo && node scripts/check-publish-artifacts.mjs
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] As três descrições estão em inglês — `pnpm run test:repo` reporta `tierD.packageDescriptions === 0`
- [ ] `check-publish-artifacts.mjs` verde
- [ ] Nenhum campo além de `description` mudou (verificar `git diff --stat`)

#### DoD
- [ ] `pnpm run test:repo` verde
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

## Phase 3: O texto lido por usuário e por agente

**Objective:** nenhuma string alcançável por um humano ou por um modelo está em português, e o campo `error` do MCP separa código de mensagem.

### T3.1 — Ferramentas MCP: descrições em inglês e `error` com código estável

#### Objective
Traduzir as quatro descrições de ferramenta e os `description` de cada parâmetro, e separar `error` (código) de `message` (texto legível).

#### Why this step (action + reasoning)

**O que este passo faz:** traduz o texto que o modelo do agente lê para escolher a ferramenta, e troca `{ error: 'query é obrigatória' }` por `{ error: 'invalid_argument', message: '...' }`.

**Por que agora:** achado 3, o de maior impacto funcional do lote. A descrição da ferramenta MCP não é documentação — é *entrada do modelo*. Em português, um agente em contexto inglês pode simplesmente não escolher a ferramenta, e o registry responde vazio para quem deveria achar. E `rules/error-handling.md` § 2 exige erro **tipado**: hoje o mesmo campo carrega `'not_found'` (código) e `'query é obrigatória'` (prosa), então nenhum cliente consegue classificar a falha de validação.

#### Evidence
- `packages/mcp/src/tools.ts:92-94` — `description: 'Busca skills por intenção em linguagem natural. …'`
- `packages/mcp/src/tools.ts:91` — comentário do próprio código: *"A descrição é lida pelo MODELO"*.
- `packages/mcp/src/tools.ts:98-100` — `description` dos parâmetros `query`, `top_k`, `category`, todos em PT.
- `packages/mcp/src/tools.ts:106` — `return { error: 'query é obrigatória' }`; `:127` — `{ error: 'skill_id é obrigatório' }`; `:131` — `skill ?? { error: 'not_found' }`.
- `packages/mcp/src/tools.ts:119` e demais ferramentas — mesma forma.

#### Files to edit
```
packages/mcp/src/tools.ts                        — descrições + separação código/mensagem
packages/mcp/src/server.ts                       — strings de servidor
packages/mcp/src/transports/streamable-http.ts   — mensagens de erro do transporte
packages/mcp/tests/contract/tools.contract.test.ts — asserções sobre o novo formato
```

#### Deep file dependency analysis
- `tools.ts` (Baseline: 172 LoC, `b8da764`) — mudam `description` e o formato de retorno de erro. O comentário de `:129-130` declara o invariante de que `not_found` é deliberado (skill de outro workspace é indistinguível de inexistente) — esse **código** não muda.
- `tools.contract.test.ts` (Baseline: 183 LoC) — asserções que casam a prosa PT precisam casar o **código**, não o texto. Aplicar aqui a mesma lição de T1.1.
- Downstream: o consumidor é qualquer cliente MCP; a adição de `message` é aditiva, a mudança de valor de `error` para as validações é **quebra de formato** — declarar no CHANGELOG.

#### Deep Dives
- **Contrato novo do erro:** `{ error: <code>, message: <human text> }` com `code ∈ {'invalid_argument', 'not_found'}`. `not_found` mantém o valor atual (não quebra quem já o consome).
- **Invariante:** `not_found` continua sendo devolvido tanto para skill inexistente quanto para skill de outro workspace — o isolamento depende de os dois serem indistinguíveis.
- **Edge cases:** cliente antigo que lê `error` como texto passa a ver `'invalid_argument'` em vez da frase; é a quebra declarada. Cliente que já ramifica em `'not_found'` não é afetado.

#### Pseudo-code / Signatures
```pseudocode
type ToolError = { error: 'invalid_argument' | 'not_found', message: string }

async invoke(args):
  query = asString(args['query'])
  if query === '':
    return { error: 'invalid_argument', message: '`query` is required: describe, in natural language, what you want to do.' }
  ...

# Example
input:  { query: '' }
output: { error: 'invalid_argument', message: '`query` is required: …' }
```

#### Tasks
1. Traduzir as 4 `description` de ferramenta.
2. Traduzir os `description` de todos os parâmetros do `inputSchema`.
3. Introduzir o par `{error, message}` nas validações; manter `not_found` como está.
4. Atualizar `tools.contract.test.ts` para asseverar o **código**, nunca a prosa.
5. Traduzir strings de `server.ts` e `streamable-http.ts`.

#### TDD
```
RED:     tool_descriptions_are_english() — nenhuma description de tool/param casa a heurística PT
RED:     validation_error_carries_stable_code() — invoke com query vazia devolve error === 'invalid_argument'
RED:     not_found_code_unchanged() — get_skill de id inexistente ainda devolve error === 'not_found'
RED:     cross_workspace_is_indistinguishable() — skill de outro workspace devolve o MESMO 'not_found'
GREEN:   Traduzir + separar código/mensagem
REFACTOR: Extrair um helper `invalidArgument(field, hint)` se o padrão repetir 3x
VERIFY:  pnpm --filter @usetheo/skills-mcp test
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhuma `description` de ferramenta ou parâmetro em português
- [ ] Toda validação devolve `error` com código estável + `message` legível
- [ ] `not_found` mantém valor e semântica (inclusive cross-workspace)
- [ ] Nenhuma asserção de teste casa prosa traduzível — `grep -rnE "toContain\('[^']*(é|obrigat|inválid)" packages/mcp/tests` retorna 0 linhas
- [ ] Pass: lint / size — `pnpm lint` sem warnings e `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] `pnpm --filter @usetheo/skills-mcp test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Changed` declarando a mudança de formato do `error`

---

### T3.2 — CLI: um binário, um idioma

#### Objective
Traduzir toda a saída de `install` e `update` (prefixo `erro:` incluído) para alinhar com `publish`/`validate`, que já falam inglês.

#### Why this step (action + reasoning)

**O que este passo faz:** substitui `erro:` por `error:` e traduz as mensagens de `install.ts` e `update.ts`.

**Por que agora:** achado 5. O mesmo binário responde em dois idiomas conforme o subcomando, e o prefixo divergente (`erro:` vs `error:`) faz qualquer `grep` de log de CI escrito contra `error:` **perder** todas as falhas desses dois comandos. A mensagem de integridade — a única linha que explica por que nada foi escrito no disco — é uma delas.

#### Evidence
- `packages/cli/src/commands/install.ts:130,146,157,173,185,198` — seis saídas com prefixo `erro:`.
- `packages/cli/src/commands/update.ts:45,53,64` — três saídas com prefixo `erro:`.
- `packages/cli/src/commands/install.ts:185` — `erro: integridade falhou — esperado …, obtido …. Nada foi escrito.`
- `packages/cli/src/index.ts` — parser já em inglês (`grep 'erro:'` retorna 0).

#### Files to edit
```
packages/cli/src/commands/install.ts — 6 mensagens + prefixo
packages/cli/src/commands/update.ts  — 3 mensagens + prefixo
packages/cli/src/index.ts            — strings residuais
packages/sdk/src/client.ts           — mensagens de SkillsApiError
packages/sdk/src/remote-skills-manager.ts — strings + identificador `chave` -> `key`
packages/cli/tests/contract/*.test.ts — asserções que casam prosa PT
```

#### Deep file dependency analysis
- `install.ts` (Baseline: 220 LoC, `5876b35`) — só strings passadas a `deps.out()`. A **ordem** das checagens não muda: integridade continua abortando antes de qualquer escrita.
- `remote-skills-manager.ts` (Baseline: 134 LoC) — a variável local `chave` (l.91) é interna, mas entra no tier C/A pela regra de identificadores; renomear é seguro (escopo de função).
- Testes de contrato da CLI que casam `erro:` precisam casar `error:` — verificar com `grep -rn "erro:" packages/cli/tests`.

#### Deep Dives
- **Invariante (Baseline `install.ts`):** a verificação de sha256 aborta **antes** de escrever; a mensagem precisa continuar dizendo explicitamente que nada foi escrito, porque é a informação que decide se o operador precisa limpar o diretório.
- **Edge case:** o prefixo `error:` já é usado por `publish`/`validate`; após a mudança, um único `grep -c '^error:'` cobre o binário inteiro — que é o ponto.

#### Tasks
1. Traduzir as 6 mensagens de `install.ts`, prefixo incluído.
2. Traduzir as 3 de `update.ts`.
3. Traduzir strings residuais de `index.ts`, `client.ts`, `remote-skills-manager.ts`.
4. Renomear identificadores locais em PT nos arquivos tocados.
5. Atualizar os testes de contrato que casam `erro:`.

#### TDD
```
RED:     cli_error_prefix_is_uniform() — toda saída de erro dos 4 subcomandos começa com 'error:'
RED:     integrity_failure_says_nothing_was_written() — mismatch de hash produz mensagem contendo 'nothing was written' e o diretório permanece vazio
RED:     install_not_found_message_is_english() — HTTP 404 produz mensagem sem palavra PT
GREEN:   Traduzir
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/skills-cli test
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `grep -rn "erro:" packages/cli/src packages/sdk/src` retorna 0
- [ ] O teste `integrity_failure_says_nothing_was_written` asserta `readdirSync(installDir)` equals `[]` após o mismatch de hash
- [ ] Todo subcomando usa o prefixo `error:`
- [ ] Pass: lint / size — `pnpm lint` sem warnings e `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] `pnpm --filter @usetheo/skills-cli test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

### T3.3 — Handlers HTTP: a metade que o commit de i18n deixou

#### Objective
Traduzir os `details` remanescentes em `publishing.ts`, `admin-keys.ts`, `platform-keys.ts`, `server.ts` e `version.ts`.

#### Why this step (action + reasoning)

**O que este passo faz:** completa a tradução iniciada em `1f7cf99`, que traduziu três `details` de `publishing.ts` e deixou dois.

**Por que agora:** achado 6. Hoje o **mesmo recurso** devolve 400 em dois idiomas conforme a rota — `PUT /v1/bundles/:id/items` responde `'items deve ser uma lista'` enquanto o `POST` vizinho responde `'revision_id is required'`. Um publisher que exibe `details` na própria interface vê os dois.

#### Evidence
- `packages/api/src/server/handlers/publishing.ts:139` — `details: 'items deve ser uma lista'`
- `packages/api/src/server/handlers/publishing.ts:145` — `details: 'cada item precisa de skill_id e channel'`
- `packages/api/src/server/handlers/publishing.ts:79,99,174` — já em inglês, no mesmo arquivo
- `packages/core/src/domain/version.ts:104,111` — `versão … já existe` / `versão … é anterior à mais recente` (hoje inalcançáveis; a T4.1 as torna alcançáveis)
- `packages/api/src/server/handlers/admin-keys.ts:42`, `platform-keys.ts:86`, `server.ts:199`, `mcp/src/transports/streamable-http.ts:202`

#### Files to edit
```
packages/api/src/server/handlers/publishing.ts     — 2 details
packages/api/src/server/handlers/admin-keys.ts     — details
packages/api/src/server/handlers/platform-keys.ts  — details
packages/api/src/server.ts                          — mensagens de boot
packages/core/src/domain/version.ts                 — mensagens de VersionRejectedError
packages/api/tests/contract/*.test.ts               — asserções sobre details
```

#### Deep file dependency analysis
- `publishing.ts` (Baseline: 230 LoC, `1f7cf99`) — só o valor de `details`; a forma `{error, details}` e o status 400 não mudam.
- `version.ts` — as duas mensagens são de erro **tipado** (`VersionRejectedError` com `reason`); traduzir a mensagem não afeta o `reason`, que é o que o handler deve ramificar (`rules/error-handling.md` § 2).
- Downstream: testes de contrato que casam a prosa PT.

#### Deep Dives
- **Invariante:** `error` (o código) nunca muda; só `details` (a prosa). É a mesma separação de T3.1, aplicada onde ela já existe corretamente.
- **Edge case:** `version.ts` traz identificadores de interpolação (`formatVersion(next)`); a tradução precisa preservar as duas interpolações da mensagem `not_greater`.

#### Tasks
1. Traduzir os dois `details` de `publishing.ts`.
2. Traduzir `admin-keys.ts`, `platform-keys.ts`, `server.ts`, `streamable-http.ts`.
3. Traduzir as duas mensagens de `VersionRejectedError`.
4. Atualizar testes de contrato que casam prosa.

#### TDD
```
RED:     bundle_items_400_details_is_english() — PUT com items não-array devolve details sem palavra PT
RED:     bundle_item_missing_field_400_is_english() — item malformado idem
RED:     error_code_unchanged() — o campo `error` continua 'invalid_request' em ambos
GREEN:   Traduzir
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/skills-api test
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhum `details` em português nos handlers listados
- [ ] O campo `error` de cada rota é idêntico ao de antes
- [ ] Pass: lint / size — `pnpm lint` sem warnings e `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] `pnpm --filter @usetheo/skills-api test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

## Phase 4: Unicidade de versão (defeito independente do idioma)

**Objective:** duas revisões diferentes não podem ocupar a mesma versão semântica de uma skill.

### T4.1 — Chamar `assertPublishable` no caminho de publicação

#### Objective
Ligar a guarda de domínio, hoje sem chamador, ao ponto onde a revisão é gravada, e mapear `VersionRejectedError` para HTTP 409.

#### Why this step (action + reasoning)

**O que este passo faz:** consulta as versões existentes antes de inserir a revisão e chama `assertPublishable`; o handler traduz a exceção tipada em 409 com a causa.

**Por que agora:** achado 2. A função existe, tem teste, e nunca roda em produção — o doc-comment dela (`version.ts:95-99`) descreve exatamente a corrupção que ela deveria impedir e que hoje acontece. Sem esta tarefa, a fase 3 traduziria mensagens de erro **inalcançáveis**, o que é o pior desfecho possível: dá aparência de cobertura sem nenhuma.

#### Evidence
- `grep -rn 'assertPublishable' --include='*.ts' packages/` → apenas `version.ts:101` (declaração), `version.test.ts` (7 ocorrências) e `core/dist/*.d.ts`. **Zero** chamadores de produção.
- `packages/api/src/server/store/skills-store.ts:295-306` e `:314-323` — os dois pontos de inserção; ambos passam `version` direto.
- `packages/core/src/infrastructure/db/schema.ts:175-179` — único índice é não-único.
- `packages/api/src/server/store/channels-store.ts:97` — `versionsOf()` já existe e devolve `{version, revisionId}[]`.

#### Files to edit
```
packages/api/src/server/store/skills-store.ts — consultar versões e chamar a guarda antes do insert
packages/api/src/server/handlers/publishing.ts — mapear VersionRejectedError -> 409
packages/api/tests/contract/publishing.contract.test.ts — RED de duplicata e de retrocesso
packages/api/tests/integration/*.integration.test.ts — RED contra banco real
```

#### Deep file dependency analysis
- `skills-store.ts` — a leitura das versões existentes precisa ocorrer **dentro** da mesma transação (`db.transaction`, l.294/313), senão a janela entre ler e inserir é ainda maior do que a que o índice de T4.2 fecha.
- `publishing.ts` — o mapeamento do erro é aditivo; nenhuma rota existente muda de status.
- `version.ts` **não** muda aqui (as mensagens são traduzidas em T3.3).

#### Deep Dives
- **Invariante:** revisão com `version === undefined` continua legítima e **não** passa pela guarda (`schema.ts:167` — nulo é o caso pré-M19).
- **Ordem:** `SELECT` das versões → `assertPublishable` → `INSERT`, tudo na mesma transação.
- **Versão histórica ilegível NUNCA derruba um publish válido (EC-6).** `schema.ts:168` é `text('version')` — texto livre, sem `CHECK`, e `assertPublishable` nunca rodou até agora (é o achado 2). Linhas antigas podem conter `'v1.2'`, `'latest'` ou `''`. Mapear `parseVersion` cru sobre elas faria o publish de uma versão **nova e válida** explodir por causa de um dado velho — e a skill ficaria impossível de publicar para sempre, com 500. A leitura filtra o que não parseia (`tryParse` devolvendo `null`) e **registra em log** as linhas descartadas: uma versão ilegível é dado a investigar, não motivo para bloquear quem está publicando certo.
- **Dois caminhos chegam ao 409, e ambos precisam ser mapeados (EC-7).** A guarda de domínio lança `VersionRejectedError`; o índice único de T4.2 lança violação de constraint do Postgres. O segundo é justamente o caminho que a guarda não vê (corrida entre dois publishes) — deixá-lo sem mapeamento devolve **500** e torna o critério de aceite de T4.2 insatisfazível. O helper já existe: `isUniqueViolation` em `packages/api/src/server/persistence/pg-errors.ts:14`, usado em `skills-store.ts:290`.
- **Edge cases:** primeira versão de uma skill (lista vazia → aceita); pré-lançamento (`2.0.0-beta.1` sobre `1.9.0` → aceito, conforme `version.test.ts:83`); revisão sem versão (ignorada pela guarda); metadado de build (ver abaixo).
- **Edge case — metadado de build (EC-13):** semver ignora `+build` na precedência, então `compareVersions('1.2.0+a','1.2.0+b') === 0` e a guarda recusa como duplicata; o índice único de T4.2 é sobre a coluna `text` e veria duas strings distintas. Guarda e banco divergem nessa fronteira. O teste abaixo fixa qual dos dois vence; se o parser já rejeitar `+build` na entrada, o caso se fecha sozinho e o teste documenta isso.

#### Pseudo-code / Signatures
```pseudocode
async function addRevision(skillId, rev):
  await db.transaction(async tx => {
    if (rev.version !== undefined) {
      const rows = await tx.select(version).from(skillRevisions)
                      .where(and(eq(workspaceId, ws), eq(skillId), isNotNull(version)))
      -- EC-6: uma versao historica ilegivel e dado a investigar, nao motivo para
      -- derrubar um publish valido. Filtra e registra; nunca lanca daqui.
      const existing = rows.map(r => tryParse(r.version))
                           .filter((v): v is SemVer => v !== null)
      if (rows.length !== existing.length) log.warn('unparseable stored versions', {skillId, dropped: ...})
      assertPublishable(parseVersion(rev.version), existing)   -- throws VersionRejectedError
    }
    try { await tx.insert(skillRevisions).values({...}) }
    catch (err) {
      -- EC-7: o indice unico (T4.2) cobre a corrida que a guarda acima nao ve.
      if (isUniqueViolation(err)) throw new VersionRejectedError('duplicate', `version ${rev.version} already exists`)
      throw err
    }
  })

# Example
input:  skill has [1.0.0, 1.1.0]; rev.version = '1.0.0'
output: throws VersionRejectedError(reason='duplicate') -> handler returns 409

# Example (EC-6)
input:  stored versions = ['1.0.0', 'latest']; rev.version = '1.1.0'
output: 'latest' dropped with a warning; assertPublishable sees ['1.0.0']; publish succeeds (201)
```

#### Tasks
1. Adicionar a leitura de versões existentes dentro da transação em ambos os pontos de inserção.
2. Filtrar versões armazenadas que não parseiam, registrando em log as descartadas (EC-6).
3. Chamar `assertPublishable` quando `version` estiver presente.
4. Envolver o `insert` num `catch` que converte `isUniqueViolation` em `VersionRejectedError('duplicate')` (EC-7).
5. Mapear `VersionRejectedError` para 409 com `{error:'version_rejected', details:<reason>}`.
6. Escrever os testes de contrato e de integração.

#### TDD
```
RED:     publish_same_version_twice_is_rejected() — segundo POST com version 1.2.0 devolve 409 reason='duplicate'
RED:     publish_lower_version_is_rejected() — 1.0.0 após 1.1.0 devolve 409 reason='not_greater'
RED:     publish_without_version_still_accepted() — revisão sem version continua 201
RED:     prerelease_over_stable_is_accepted() — 2.0.0-beta.1 sobre 1.9.0 continua 201
RED:     unparseable_stored_version_does_not_block_publish() — [EC-6] linha histórica com 'latest' semeada; publicar 1.1.0 devolve 201 e a linha ilegível aparece no log
RED:     unique_violation_maps_to_409_not_500() — [EC-7] insert forçado a violar o índice devolve 409 reason='duplicate'
RED:     build_metadata_boundary_is_pinned() — [EC-13] publicar '1.2.0+a' e depois '1.2.0+b' tem resultado FIXO e declarado (409 pela guarda, ou 400 se o parser recusa +build)
GREEN:   Ligar a guarda dentro da transação + filtrar ilegíveis + mapear os dois caminhos de erro
REFACTOR: Extrair a leitura de versões para um helper do store se repetir nos dois pontos
VERIFY:  pnpm --filter @usetheo/skills-api test && pnpm --filter @usetheo/skills-api test:integration
```

#### Concurrency tests

Esta tarefa toca estado sob transação (`db.transaction`) e a guarda é um ler-depois-escrever — o modo de falha é TOCTOU.

- **Concurrent test — invariante de escritores simultâneos:** N publishes da **mesma** versão da mesma skill; ao final, exatamente **1** revisão com aquela versão existe e N−1 chamadas receberam 409. Teste de integração com `Promise.all` sobre N=10 requisições contra Postgres real (`parallel test` sobre o mesmo recurso).
- **Happens-before observation:** barreira `Promise.all` seguida de `SELECT count(*)` sobre `(workspace_id, skill_id, version)` — a asserção só ocorre depois que todas as escritas terminaram.
- **Atomic-counter invariant:** a contagem final de linhas para `(ws, skill, version)` é exatamente 1, independentemente da ordem de interleaving — é o Lost-Update que o índice de T4.2 impede.
- **Nota honesta:** este teste **falha** enquanto só a guarda existir (é o RED de T4.2) — é o que prova que o índice único de T4.2 é necessário e não redundante.

#### Acceptance Criteria
- [ ] `assertPublishable` tem chamador de produção (verificável por `grep`)
- [ ] 409 com `reason` distinguível entre `duplicate` e `not_greater`
- [ ] Revisão sem versão continua aceita — `publish_without_version_still_accepted` asserta status equals 201
- [ ] Versão armazenada ilegível **não** bloqueia publish válido — `unparseable_stored_version_does_not_block_publish` asserta status equals 201 e que o log contains `unparseable stored versions`
- [ ] Violação de unicidade do banco vira 409 — `unique_violation_maps_to_409_not_500` asserta status equals 409 e `reason` equals `duplicate`
- [ ] O teste de concorrência está escrito e **documentadamente vermelho** até T4.2 — `pnpm --filter @usetheo/skills-api test:integration -t concurrent` retorna exit code 1, com a saída colada no log
- [ ] Pass: lint / size — `pnpm lint` sem warnings e `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] `pnpm --filter @usetheo/skills-api test` verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Fixed` atualizado

---

### T4.2 — Índice único parcial em `(workspace_id, skill_id, version)`

#### Objective
Fechar a janela TOCTOU que a guarda de domínio sozinha não cobre.

#### Why this step (action + reasoning)

**O que este passo faz:** detecta duplicatas preexistentes, e — se não houver — adiciona `uniqueIndex` parcial (`WHERE version IS NOT NULL`) em `schema.ts` mais a migração SQL.

**Por que agora:** D6. A guarda de T4.1 lê antes de escrever; dois publishes concorrentes passam ambos pela leitura. O índice é a única barreira que o banco impõe. Parcial porque `version` nulo é legítimo (`schema.ts:167`).

**Bloqueado por Q3** — a decisão sobre duplicatas já existentes é do owner.

#### Evidence
- `packages/core/src/infrastructure/db/schema.ts:175-179` — o único índice de `skill_revisions` é não-único.
- `packages/core/src/infrastructure/db/schema.ts:204` — precedente de `uniqueIndex` composto no mesmo arquivo (`embeddings_revision_provider_model_uq`).
- `packages/core/src/infrastructure/db/schema.ts:233,242` — precedente de índice **parcial** (`operations_ws_idempotency_key_uq`, com o comentário *"partial-unique: many NULLs allowed"*).
- `schema.ts` está com 473 LoC — orçamento de 500 deixa ~27 linhas de folga.

#### Files to edit
```
packages/core/src/infrastructure/db/schema.ts — uniqueIndex parcial
packages/core/src/infrastructure/db/migrations/00XX_*.sql (NEW) — a migração
packages/api/tests/integration/*.integration.test.ts — teste de concorrência de T4.1 vira VERDE
```

#### Deep file dependency analysis
- `schema.ts` — soma ~5 linhas; se estourar 500 LoC, a extração da seção de revisões para um módulo próprio entra no escopo desta tarefa (`rules/architecture.md`).
- A migração é aditiva; `CREATE UNIQUE INDEX` falha se houver duplicata, e é isso que torna a consulta de detecção obrigatória **antes**.

#### Deep Dives
- **Consulta de detecção (roda antes de gerar a migração):**
  ```sql
  SELECT workspace_id, skill_id, version, count(*)
  FROM skill_revisions WHERE version IS NOT NULL
  GROUP BY 1,2,3 HAVING count(*) > 1;
  ```
- **Invariante:** revisões com `version NULL` continuam ilimitadas por skill.
- **Edge case:** aplicar a migração num banco com duplicata **falha** — comportamento correto (fail-fast), não a contornar com `ON CONFLICT`.

#### Tasks
1. Rodar a consulta de detecção e registrar o resultado no log de implementação.
2. Se count > 0, parar e escalar (Q3).
3. Adicionar `uniqueIndex(...).on(workspaceId, skillId, version).where(isNotNull(version))`.
4. Gerar a migração com `pnpm db:generate` e revisar o SQL à mão.
5. Rodar o teste de concorrência de T4.1 e confirmar que passa a verde.

#### TDD
```
RED:     concurrent_publish_same_version_yields_one_row() — o teste escrito em T4.1, ainda vermelho, agora deve passar
RED:     null_version_rows_remain_unconstrained() — 3 revisões sem versão na mesma skill continuam aceitas
GREEN:   Adicionar o índice + migração
REFACTOR: Extrair a seção de revisões de schema.ts se o arquivo passar de 500 LoC
VERIFY:  pnpm --filter @usetheo/skills-api test:integration
```

#### Concurrency tests

- **Concurrent test — escritores simultâneos:** N=10 `Promise.all` publicando a mesma versão → exatamente 1 linha; as demais recebem 409 (da guarda) ou violação de unicidade mapeada para 409 (do índice). É o mesmo `parallel test` de T4.1, agora esperado **verde**.
- **Atomic-counter invariant:** `SELECT count(*)` sobre `(ws, skill, version)` devolve 1 após a barreira — o índice único é o que torna o invariante verdadeiro sob qualquer interleaving.
- **Cancellation propagation:** não aplicável — não há estrutura de cancelamento no caminho de publish (sem `AbortSignal` nem contexto cancelável); registrado para que a ausência seja uma decisão, não um esquecimento.

#### Acceptance Criteria
- [ ] A consulta de detecção foi executada — a saída de `SELECT ... HAVING count(*) > 1` está colada no log de implementação e o total equals 0
- [ ] O índice é parcial (`WHERE version IS NOT NULL`)
- [ ] O teste de concorrência de T4.1 passa — `pnpm --filter @usetheo/skills-api test:integration -t concurrent` retorna exit code 0
- [ ] Revisões sem versão continuam ilimitadas — `null_version_rows_remain_unconstrained` insere 3 linhas com `version NULL` e asserta que nenhuma é recusada
- [ ] Pass: size — `schema.ts` ≤ 500 linhas (ou extraído)

#### DoD
- [ ] `pnpm --filter @usetheo/skills-api test:integration` verde
- [ ] Migração revisada à mão e aplicada em ambiente de teste
- [ ] CHANGELOG `[Unreleased] § Fixed` atualizado

---

## Phase 5: Comentários e identificadores internos

**Objective:** nenhuma linha de comentário em `packages/*/src/**` está em português — preservando o raciocínio que esses comentários carregam.

### T5.1 a T5.5 — Dois commits por pacote (`core`, `api`, `mcp`, `cli`, `sdk`)

#### Objective
Traduzir as 1554 linhas de comentário e renomear os identificadores internos em PT, por pacote, em **dois commits separados** — comentários primeiro, identificadores depois.

#### Why this step (action + reasoning)

**O que este passo faz:** por pacote, um commit `docs(<pkg>)` só de comentários (com prova de JS emitido idêntico) e, em seguida, um commit `refactor(<pkg>)` só de renames de identificador (com a suíte do pacote como prova).

**Por que dois commits e não um (EC-9):** a v1.0 pedia as duas coisas no mesmo commit e, no mesmo fôlego, exigia que "o JS emitido fosse byte-idêntico" e que "nenhuma linha de código mudasse". Renomear `chave` → `key` **altera** o JS emitido — os dois requisitos não coexistem, e o critério de aceite era insatisfazível. Separar preserva a única prova mecânica de que a tradução não alterou comportamento, sem abrir mão dos renames.

**Por que agora e por último:** é o maior diff do plano (1554 linhas) e o de menor risco funcional. Colocá-lo antes tornaria irrevisáveis os diffs das fases 2–4, onde mora o risco real. Colocá-lo por pacote mantém cada commit auditável. A regra é **traduzir preservando o porquê**: esses comentários explicam decisões (ver `discoverability.ts:37-51`, que documenta por que a união é discriminada) e resumir destrói o ativo.

#### Evidence
- Medição 2026-08-05 por pacote: `api` 838, `core` 408, `mcp` 136, `cli` 94, `sdk` 78 linhas de comentário com acento.
- `packages/core/src/domain/discoverability.ts:37-51` — exemplo do tipo de comentário em jogo: uma tabela explicando o que `no_embedding` significa em cada estado. Perder isso é perder a razão da correção do #144.
- `packages/api/src/server/app.ts:65-70` — comentário que explica por que a costura de teste existe.

#### Files to edit
```
packages/core/src/**/*.ts   — T5.1 (408 linhas)
packages/api/src/**/*.ts    — T5.2 (838 linhas)
packages/mcp/src/**/*.ts    — T5.3 (136 linhas)
packages/cli/src/**/*.ts    — T5.4 (94 linhas)
packages/sdk/src/**/*.ts    — T5.5 (78 linhas)
tests/repo/language-budget.json — tier C decrescendo a cada commit
```

#### Deep file dependency analysis
- Nenhum comportamento muda. O risco é humano: traduzir e, sem perceber, alterar uma linha de código adjacente. A mitigação é mecânica — cada commit é verificado com um diff que ignora comentários e deve resultar vazio.

#### Deep Dives
- **Invariante do commit 1 (comentários):** o JS emitido é **byte-idêntico** ao do commit anterior. Verificação: `pnpm --filter <pkg> build` antes e depois, comparando apenas `dist/**/*.js`.
- **A comparação exclui o `.d.ts` (EC-14).** O `tsc` **preserva JSDoc no `.d.ts`** (`packages/api/tsconfig.build.json:7` confirma `declaration: true` no padrão do repo, e `packages/core/dist/index.d.ts` existe). Traduzir um bloco `/** … */` altera legitimamente os bytes do `.d.ts`; exigir identidade ali reprovaria um commit correto. O `.d.ts` é coberto pelo outro eixo: a lista de **nomes** de T1.3 não pode mudar num commit de comentários.
- **Invariante do commit 2 (identificadores):** o JS emitido **muda** — é o esperado. A prova aqui é a suíte do pacote verde mais a lista de nomes exportados de T1.3 inalterada (os renames são de escopo interno; se algum vazar para a superfície, o snapshot acusa).
- **Identificadores internos em PT** (`chave`, `faltando`, `maior`, `versoes`, `canais`, `brutos`, `descricao`, `rival`, …) vão no commit 2, por pacote.
- **Edge case:** comentário que cita um identificador PT renomeado no commit 2 — a citação é atualizada **no commit 2**, junto com o identificador, e não no commit 1.

#### Tasks (repetidas por pacote)
1. **Commit 1** — traduzir os comentários do pacote.
2. Rodar a verificação de emit: `dist/**/*.js` byte-idêntico; `.d.ts` pode diferir só em JSDoc.
3. Atualizar o tier C do orçamento e commitar como `docs(<pkg>): translate comments`.
4. **Commit 2** — renomear identificadores locais em PT do pacote.
5. Rodar a suíte do pacote e confirmar a lista de nomes de T1.3 inalterada.
6. Atualizar o tier A/C do orçamento e commitar como `refactor(<pkg>): rename PT identifiers`.

#### TDD
```
RED:     language_gate_tier_C_is_zero_for_<pkg>() — o portão de T0.1 reprova enquanto o pacote tiver comentário PT
RED:     emitted_js_is_unchanged_for_<pkg>() — [EC-14] no commit 1, `dist/**/*.js` é byte-idêntico ao do commit anterior; a comparação NÃO inclui .d.ts
RED:     exported_names_unchanged_for_<pkg>() — em AMBOS os commits, a lista de nomes de T1.3 é idêntica (um rename que vaze para a superfície é acusado aqui)
GREEN:   Traduzir (commit 1); renomear (commit 2)
REFACTOR: None expected
VERIFY:  pnpm --filter <pkg> build && pnpm --filter <pkg> test && pnpm run test:repo
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Tier C do pacote equals 0 — `pnpm run test:repo` reporta `tierC.<pkg> === 0`
- [ ] O commit 1 produz `dist/**/*.js` byte-idêntico ao anterior (a comparação exclui `.d.ts`, que carrega JSDoc)
- [ ] O commit 2 mantém a lista de nomes exportados inalterada — `git diff HEAD~1 -- tests/repo/core-api-surface.json` retorna vazio
- [ ] Comentários e identificadores estão em **commits separados** (verificar `git log --oneline` do pacote)
- [ ] Nenhum comentário foi **removido** para satisfazer o portão — a contagem de linhas de comentário do pacote antes e depois difere em menos de 5% (`git diff --stat` + contagem por `grep -c`)
- [ ] Pass: lint / size — `pnpm lint` sem warnings e `wc -l` ≤ 500 em todo arquivo alterado

#### DoD
- [ ] Suíte do pacote verde
- [ ] `pnpm typecheck` sem erros
- [ ] CHANGELOG `[Unreleased] § Changed` com uma entrada agregada para a fase

---

## Phase 6: Documentação, CI e metadados

**Objective:** documentação, nomes de job/step de CI, nomes de arquivo e dados de eval em inglês — com a branch protection re-apontada no mesmo passo.

### T6.1 — Documentação

#### Objective
Traduzir `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `PRD.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `docs/credential-rotation.md`, `docs/integracao-theokit-mcp.md`, e os comentários do `Dockerfile` e das migrações SQL.

#### Why this step (action + reasoning)

**O que este passo faz:** traduz 9 documentos e renomeia `docs/integracao-theokit-mcp.md` → `docs/theokit-mcp-integration.md`.

**Por que agora:** achado 10. `SECURITY.md` é o que um pesquisador externo lê **antes** de divulgar uma vulnerabilidade, e `RUNBOOK.md` é o que o on-call lê **durante** um incidente. São os dois documentos em que "está em português" custa mais caro, e ambos custam no pior momento possível.

**Bloqueado por Q5** — o CHANGELOG entra ou não.

#### Evidence
- Medição 2026-08-05: `README.md` 182 marcas PT / 253 linhas; `SECURITY.md` 83 / 42; `docs/ARCHITECTURE.md` 145 / 82; `docs/RUNBOOK.md` 85 / 85; `docs/credential-rotation.md` 104 / 68; `CONTRIBUTING.md` 58 / 80; `PRD.md` 438 / 390.
- `Dockerfile:1-6` — comentários PT, incluindo a nota de que o major do Node é travado por `gates.test.ts`.
- `packages/core/src/infrastructure/db/migrations/0014_lean_living_mummy.sql:5-10` — comentário PT explicando o CHECK escrito à mão.
- `rules/public-copy.md` § 3 — governa a linguagem do README; a tradução deve respeitar as proibições de "production-ready" etc.

#### Files to edit
```
README.md · CONTRIBUTING.md · SECURITY.md · CODE_OF_CONDUCT.md · PRD.md
docs/ARCHITECTURE.md · docs/RUNBOOK.md · docs/credential-rotation.md
docs/integracao-theokit-mcp.md -> docs/theokit-mcp-integration.md (git mv)
Dockerfile — comentários
packages/core/src/infrastructure/db/migrations/*.sql — comentários
packages/api/tests/integration/m28-execution-nao-confiavel.integration.test.ts -> m28-untrusted-execution.integration.test.ts (git mv)
```

#### Deep file dependency analysis
- Renomear `docs/integracao-theokit-mcp.md` quebra links internos — `grep -rn 'integracao-theokit-mcp' .` antes do `git mv`, e atualizar cada ocorrência no mesmo commit.
- Renomear o teste de integração: confirmar que `packages/api/vitest.integration.config.ts` casa por glob (`**/*.integration.test.ts`) e não por lista explícita — senão a config entra em "Files to edit".
- `Dockerfile` e migrações: só comentários; `gates.test.ts` lê o `FROM` do Dockerfile, não os comentários.

#### Deep Dives
- **Invariante:** todo link relativo continua resolvendo após os renames; verificação por script simples que abre cada link markdown local.
- **Invariante (`rules/public-copy.md`):** a tradução do README não pode introduzir "production-ready"/"battle-tested"; o hook `public-copy-lint.sh` roda sobre o resultado.
- **Edge case:** `PRD.md` (390 linhas) é documento de produto com decisões históricas; traduzir sem reinterpretar.

#### Tasks
1. Traduzir os 9 documentos.
2. `git mv` dos dois arquivos com nome em português; atualizar referências.
3. Traduzir comentários de `Dockerfile` e migrações.
4. Rodar o verificador de links e o `public-copy-lint`.

#### TDD
```
RED:     language_gate_tier_D_docs_is_zero() — o portão reprova enquanto houver doc PT
RED:     all_relative_markdown_links_resolve() — após os renames, nenhum link local quebrado
RED:     public_copy_lint_clean() — README traduzido não introduz framing proibido
GREEN:   Traduzir + renomear + corrigir links
REFACTOR: None expected
VERIFY:  pnpm run test:repo && bash .claude/hooks/public-copy-lint.sh
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Os 9 documentos em inglês — `pnpm run test:repo` reporta `tierD.docs === 0`
- [ ] Nenhum nome de arquivo rastreado em português — `pnpm run test:repo` reporta `tierD.filenames === 0`
- [ ] Todo link markdown relativo resolve — o teste `all_relative_markdown_links_resolve` asserta que a lista de links quebrados equals `[]`
- [ ] `public-copy-lint` limpo
- [ ] Decisão de Q5 registrada — o log de implementação contains a linha `Q5: CHANGELOG in scope = yes|no` e o `language-budget.json` reflete a escolha

#### DoD
- [ ] `pnpm run test:repo` verde com tier D de docs = 0
- [ ] `pnpm --filter @usetheo/skills-api test:integration` continua coletando o teste renomeado
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

### T6.2 — Nomes de job/step do CI + branch protection, num passo só

#### Objective
Traduzir os 15 `name:` em português dos 7 workflows e re-apontar os required status checks na mesma janela.

#### Why this step (action + reasoning)

**O que este passo faz:** renomeia os `name:` e, imediatamente, atualiza os contextos exigidos na branch protection — com verificação por comando antes e depois.

**Por que agora e por que junto:** achado 8 e D7. O `name:` do job É o contexto do required check. Renomear sem re-apontar deixa a proteção esperando um contexto que nunca mais será reportado, e todo PR aberto trava — o mesmo modo de falha já registrado na memória do projeto (`required-check-vs-paths-ignore`).

**Bloqueado por Q4** — precisa de quem tem admin no remoto.

#### Evidence
- `.github/workflows/ci.yml:98` — `name: build + lint + typecheck + test (sem banco)` (job `static`).
- `.github/workflows/integration.yml:70` — `name: integração contra pgvector real` (job).
- Mais 13 `name:` de step em `actionlint.yml`, `build-publish.yml`, `ci.yml`, `publish-npm.yml`, `publish.yml`, `security-sast.yml` — enumerados na medição de 2026-08-05.
- `tests/workflows/gates.test.ts:26` lê `jobs.static.steps` pela **chave**, não pelo `name:` — o rename não quebra o teste.
- `tests/workflows/gates.test.ts:206-207` casa `/smoke/i` e `/build \+ push/i`; ambos sobrevivem à tradução (`Smoke — the image comes up`, `Build + push`) — confirmar no diff.
- `gh api repos/.../branches/*/protection` **não resolve deste checkout** (remote usa o alias `github-usetheo`); daí Q4.

#### Files to edit
```
.github/workflows/actionlint.yml      — 1 name
.github/workflows/build-publish.yml   — 4 names
.github/workflows/ci.yml              — 3 names (1 é JOB name -> required check)
.github/workflows/integration.yml     — 2 names (1 é JOB name -> required check)
.github/workflows/publish-npm.yml     — 2 names
.github/workflows/publish.yml         — 1 name
.github/workflows/security-sast.yml   — 2 names
package.json                          — script `test:workflows` -> `test:repo` (alias removido aqui)
```

#### Deep file dependency analysis
- `ci.yml` — o step `Test — invariantes dos workflows` chama `pnpm run test:workflows`; se o script for renomeado, o step muda junto, no mesmo commit.
- `gates.test.ts` — rodar **antes e depois** do rename; qualquer falha indica um `name:` que um teste casava e que a tradução quebrou.

#### Deep Dives
- **Procedimento da janela (ordem obrigatória):**
  1. `gh api repos/usetheoai/theo-skills/branches/develop/protection --jq '.required_status_checks.contexts'` — registrar a lista atual.
  2. `gh pr list --state open --json number,headRefName` — **registrar todo PR aberto**; eles são a população afetada (EC-8).
  3. Abrir o PR com os renames; **não** mergear.
  4. Deixar o CI rodar no PR e coletar os **novos** nomes de contexto reportados.
  5. Atualizar `contexts` na proteção para a lista nova.
  6. Mergear o PR do rename.
  7. **Para cada PR listado no passo 2:** mergear `develop` na branch dele (`gh pr checkout N && git merge develop && git push`), para que ele passe a reportar os contextos novos.
  8. Reexecutar o `gh api` e confirmar que a lista bate com os nomes novos; reexecutar `gh pr list` e confirmar que nenhum PR ficou com check pendente que ninguém vai reportar.
- **Por que o passo 7 existe (EC-8):** um PR que ramificou **antes** do rename roda os workflows com os nomes antigos e reporta os contextos antigos. Assim que a proteção passa a exigir os novos (passo 5), esses PRs ficam bloqueados sem saída — o contexto exigido nunca será reportado por eles. A v1.0 prometia no critério de aceite que "nenhum PR aberto ficou travado" e o procedimento garantia o contrário. Alternativa aceitável: executar a janela com **zero** PRs abertos, e nesse caso o passo 7 é vazio por construção — mas isso precisa ser verificado no passo 2, não presumido.
- **Invariante:** em nenhum momento a proteção exige um contexto que nenhum workflow produz **para os PRs vivos**.
- **Edge case:** se a proteção usar `checks` (com `app_id`) em vez de `contexts`, o procedimento é o mesmo campo a campo — verificar qual dos dois está em uso no passo 1.

#### Tasks
1. Registrar os contextos exigidos hoje e **a lista de PRs abertos** (passos 1–2 acima).
2. Traduzir os 15 `name:`.
3. Renomear o script e o step que o chama.
4. Rodar `pnpm run test:repo` (inclui `gates.test.ts`) e `actionlint`.
5. Executar o procedimento da janela, passos 3–8 — **incluindo o passo 7**, que rebaseia/mergeia `develop` em cada PR aberto.

#### TDD
```
RED:     language_gate_tier_D_ci_names_is_zero() — o portão reprova enquanto houver name: PT
RED:     workflow_gates_still_green() — gates.test.ts passa antes E depois do rename
RED:     no_required_context_without_producer() — todo contexto exigido pela proteção casa um job name presente nos workflows
RED:     every_open_pr_reports_the_new_contexts() — [EC-8] após o passo 7, cada PR da lista do passo 2 tem os contextos novos reportados; um PR com check pendente sem produtor reprova a janela
GREEN:   Traduzir + re-apontar + propagar develop para os PRs abertos
REFACTOR: None expected
VERIFY:  pnpm run test:repo && gh api .../protection --jq '.required_status_checks' && gh pr list --state open
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhum `name:` em português nos 7 workflows
- [ ] `gates.test.ts` verde antes e depois
- [ ] A lista de contextos exigidos bate com os nomes novos, verificada por comando (saída colada no log de implementação)
- [ ] Todo PR listado no passo 2 recebeu `develop` e reporta os contextos novos (saída de `gh pr list` antes e depois no log) — ou a lista do passo 2 estava vazia, o que foi **verificado**, não presumido

#### DoD
- [ ] `pnpm run test:repo` verde
- [ ] `actionlint` limpo
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

### T6.3 — Dataset de eval: código traduzido, queries com carve-out datado

#### Objective
Traduzir as chaves de documentação e os identificadores do runner; manter as 3 `query` em português sob carve-out com sunset.

#### Why this step (action + reasoning)

**O que este passo faz:** traduz `_note`/`_acervo`/`_honestidade`/`_envelhecimento`/`_why` e os identificadores `existe`/`esperada` de `run-discoverability.ts`; registra as queries como carve-out do tier D com sunset 2026-11-05 e issue.

**Por que assim:** D5. As queries medem recall contra um acervo **real** em português; traduzi-las sem traduzir o acervo compara intenção em inglês com descrição em português e derruba o recall — o gate passaria a reportar regressão de produto onde só houve mudança de idioma da pergunta.

**Bloqueado por Q1** — o usuário decide se aceita o carve-out ou prefere migrar o acervo primeiro.

#### Evidence
- `packages/api/eval/run-discoverability.ts:20,68,71,77` — só `expect_skill_id` e `query` são lidos do dataset; as chaves com `_` são documentação-em-dado e podem ser renomeadas sem quebra.
- `packages/api/eval/discoverability-dataset.json` — campo `_honestidade` registra: medido em 2026-08-04 no app-dev, embedder `openai/text-embedding-3-small`, duas das três skills **sem vetor**.
- Os três `expect_skill_id` (`redteam-cambio-1785615135`, `auditar-dependencias-m33`, `revisar-contrato`) são skills reais do acervo, com descrições em português.

#### Files to edit
```
packages/api/eval/discoverability-dataset.json — chaves + textos de documentação (NÃO as queries)
packages/api/eval/run-discoverability.ts       — identificadores `existe`, `esperada`, comentários
tests/repo/language-budget.json                 — carve-out das 3 queries, com sunset e issue
```

#### Deep file dependency analysis
- `run-discoverability.ts` (Baseline: 124 LoC, `50ec38a`) — lê `caso.expect_skill_id` e `caso.query`; renomear as chaves `_*` não o afeta. Renomear `existe`/`esperada` muda o **relatório** emitido — verificar se alguém o consome (o gate do CI lê o exit code, não os nomes de campo).
- O carve-out precisa de issue aberta antes do merge (`rules` de issues: criar é o default).

#### Deep Dives
- **Invariante (do próprio dataset):** skill ausente do acervo é reportada e **não** conta como regressão — `run-discoverability.ts:77` (`existe`). Renomear o campo não pode alterar essa distinção.
- **Edge case:** carve-out expirado (após 2026-11-05) faz o portão voltar a contar as 3 queries — que é o comportamento desejado: força a revisita.

#### Tasks
1. Traduzir as 5 chaves de documentação e seus textos.
2. Renomear `existe` → `existsInRegistry` e `esperada` → `expected`.
3. Abrir issue "translate eval queries after the app-dev registry is migrated to English".
4. Registrar o carve-out no orçamento com `sunset: 2026-11-05` e o número da issue.

#### TDD
```
RED:     eval_runner_still_reads_query_and_expect_skill_id() — após o rename das chaves _*, o runner produz o mesmo relatório
RED:     missing_skill_is_not_counted_as_regression() — skill ausente do acervo continua reportada sem reprovar
RED:     carve_out_requires_sunset_and_issue() — o portão rejeita carve-out sem sunset ou sem issue
GREEN:   Traduzir + registrar o carve-out
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/skills-api exec tsx eval/run-discoverability.ts && pnpm run test:repo
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] As chaves e textos de documentação do dataset estão em inglês — `pnpm run test:repo` reporta 0 violações em `packages/api/eval/`, exceto o carve-out declarado
- [ ] As 3 `query` permanecem em português, com carve-out datado e issue aberta
- [ ] O runner produz relatório equivalente — `pnpm --filter @usetheo/skills-api exec tsx eval/run-discoverability.ts` retorna exit code 0 e o número de casos equals 3
- [ ] O portão rejeita carve-out sem `sunset` ou sem `issue`

#### DoD
- [ ] `pnpm run test:repo` verde
- [ ] Issue aberta e referenciada no orçamento
- [ ] CHANGELOG `[Unreleased] § Changed` atualizado

---

## Coverage Matrix

| # | Gap / Requirement (achado do `/code-review` 2026-08-05) | Task(s) | Resolution |
|---|---|---|---|
| 1 | `packages/core/src/index.ts:112` — símbolos PT são a API pública publicada no npm; rename é quebra indetectável | T1.3, T2.1 | Snapshot de superfície criado **antes**; rename declarado no CHANGELOG com tabela de migração |
| 2 | `packages/core/src/domain/version.ts:101` — `assertPublishable` sem chamador; sem índice único | T4.1, T4.2 | Guarda ligada dentro da transação + índice único parcial; 409 tipado |
| 3 | `packages/mcp/src/tools.ts:93` — descrições MCP em PT; `error` mistura código e prosa | T3.1 | Descrições traduzidas; `{error: <code>, message: <text>}`; `not_found` preservado |
| 4 | `packages/mcp/tests/contract/bin.contract.test.ts:53` — asserção negativa sobre literal PT vira vacua | T1.1 | Asserção passa a citar o nome da variável de ambiente, não a frase |
| 5 | `packages/cli/src/commands/install.ts:130` — binário fala dois idiomas conforme o subcomando | T3.2 | `erro:` → `error:` e mensagens traduzidas em `install`/`update`/SDK |
| 6 | `packages/api/src/server/handlers/publishing.ts:139` — mesmo recurso devolve 400 em dois idiomas | T3.3 | `details` restantes traduzidos; campo `error` inalterado |
| 7 | `packages/core/src/domain/discoverability.ts:141` — só o ramo de rascunho tem guarda de cardinalidade | T1.2 | Guarda estendida aos quatro ramos |
| 8 | `.github/workflows/ci.yml:98` — nomes de job PT são os required status checks | T6.2 | Rename + re-apontamento da proteção em janela única, verificada por comando |
| 9 | `packages/api/eval/discoverability-dataset.json:2` — chaves e queries em PT | T6.3 | Chaves e identificadores traduzidos; queries sob carve-out datado (D5) |
| 10 | `docs/ARCHITECTURE.md:1` — docs operacionais e de contribuição em PT | T6.1, T2.2 | 9 documentos + Dockerfile + migrações + 2 renames de arquivo + 3 descrições de pacote |
| 11 | (requisito do usuário, além dos achados) — comentários de código em PT-BR | T5.1–T5.5 | 1554 linhas traduzidas, um commit por pacote, com prova de JS emitido idêntico |
| 12 | (requisito do usuário) — a varredura não pode regredir | T0.1 | Portão com catraca por tier, no CI |
| 13 | EC-1/EC-2 — a catraca comparava contra `HEAD`, que num PR é o merge commit; e `fetch-depth: 1` impede o merge-base | T0.1 | Base passa a ser `git merge-base origin/develop HEAD` (ou `PR_BASE_SHA`); `fetch-depth: 0` no job `static`; pulo declarado em voz alta quando a base não resolve |
| 14 | EC-3 — a heurística de acento não via PT sem acento, e os dois arquivos-alvo da T6.1 escapariam | T0.1 | Normalização NFD + lista de radicais sem acento; tier D inicial conta os 2 nomes de arquivo |
| 15 | EC-4 — carve-out com `sunset` inválido nunca expirava (bypass permanente) | T0.1 | `Date.parse` NaN é **rejeitado** na entrada, nunca interpretado |
| 16 | EC-5 — o snapshot de nomes não enxerga rename de **campo**, que é o que a T2.1 faz | T1.3, T2.1 | Segundo nível: `core-api-surface.d.ts` versionado e comparado por conteúdo |
| 17 | EC-6 — versão histórica ilegível derrubaria um publish válido | T4.1 | `tryParse` + filtro + log das descartadas |
| 18 | EC-7 — nenhuma tarefa mapeava violação de unicidade para 409 (critério de T4.2 era insatisfazível) | T4.1 | `catch (isUniqueViolation) → VersionRejectedError('duplicate')`, reusando `pg-errors.ts:14` |
| 19 | EC-8 — a janela do rename de CI travaria todo PR aberto | T6.2 | Passos 2 e 7 do procedimento: registrar os PRs abertos e propagar `develop` para cada um |
| 20 | EC-9/EC-14 — T5.x exigia comentários e renames no mesmo commit com emit byte-idêntico (insatisfazível), e o `.d.ts` carrega JSDoc | T5.1–T5.5 | Dois commits por pacote; a comparação de emit cobre só `dist/**/*.js` |

**Coverage: 20/20 gaps covered (100%)** — 12 do `/code-review` + requisito do usuário, 8 do `/edge-case-plan`.

## Global Definition of Done

- [ ] Todas as fases concluídas
- [ ] Todos os testes verdes — `pnpm test` e `pnpm test:integration`
- [ ] Zero erros de tipo — `pnpm typecheck`
- [ ] Zero warnings de lint — `pnpm lint`
- [ ] Orçamento de tamanho respeitado (500 LoC/arquivo; atenção a `schema.ts`, hoje em 473)
- [ ] `CHANGELOG.md` atualizado sob `[Unreleased]` (Regra Inquebrável 6)
- [ ] Compatibilidade retroativa: a **quebra** de T2.1 e T3.1 está declarada explicitamente, com tabela de migração — nunca silenciosa
- [ ] `pnpm run test:repo` com tiers A, B, C e D em **0** (exceto o carve-out de D5, declarado com sunset e issue)
- [ ] **Runtime-metric proof** — o 409 de versão duplicada é observado num teste de integração real, não só compilado (T4.1/T4.2)
- [ ] Q1–Q5 respondidas e registradas no log de implementação
- [ ] **Plan archived** — após `/review` retornar `READY_TO_MERGE` **e** o PR ser mergeado, mover para `knowledge-base/plans/completed/english-only-sweep-plan.md`

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:skill_revisions` (DB) | dois publishes concorrentes da mesma versão | `Promise.all` de 10 requisições contra Postgres real (testcontainer ou compose) | exatamente 1 linha gravada; as outras 9 recebem 409; nenhuma escrita parcial |
| `postgres:skill_revisions` (DB) | migração de índice único aplicada sobre duplicatas preexistentes | rodar a migração num banco semeado com 2 revisões na mesma versão | a migração **falha** com erro claro; nada é aplicado pela metade; a consulta de detecção (T4.2) já teria acusado |
| `registry HTTP` (CLI `install`) | 404 na skill | mock do servidor devolvendo 404 | `error:` em inglês nomeando a skill e o status; nada escrito no disco |
| `registry HTTP` (CLI `install`) | payload com hash divergente | mock devolvendo bytes alterados | aborta antes de escrever; mensagem em inglês diz explicitamente que nada foi escrito; diretório de instalação vazio |
| `registry HTTP` (SDK `remote-skills-manager`) | timeout / 5xx na resolução | mock com atraso acima do TTL e com 503 | `degraded` fica `true`; o cache antigo é servido quando existe; a mensagem de degradação está em inglês |
| `MCP streamable-HTTP` (transporte) | requisição JSON-RPC malformada | enviar corpo inválido | código JSON-RPC inalterado; `message` em inglês |
| `npm registry` (publish) | publish com superfície de API alterada sem atualizar o snapshot | rodar `test:repo` no pipeline de publish com um rename não commitado | o gate reprova **antes** do `npm publish`; nada é publicado |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** provar que a varredura não quebrou comportamento e que o portão de fato protege.

### Execution

```
pnpm test                      # unit + contract de todos os pacotes
pnpm test:integration          # integração (exige Postgres — pnpm compose:up)
pnpm run test:repo             # portão de idioma + gates de workflow + superfície de API
pnpm typecheck                 # zero erros de tipo
pnpm lint                      # zero warnings
pnpm build                     # o dist reflete a superfície renomeada
node scripts/check-publish-artifacts.mjs
bash .claude/hooks/public-copy-lint.sh
```

Passe de caos (linha `## Failure scenarios`):

```
pnpm --filter @usetheo/skills-api test:integration -t 'concurrent'
```

### Acceptance Criteria

- [ ] Todas as suítes verdes — `pnpm test` e `pnpm test:integration` retornam exit code 0
- [ ] `pnpm run test:repo` com tiers A/B/C = 0 e D = apenas o carve-out declarado
- [ ] Zero erros de tipo e zero warnings de lint — `pnpm typecheck` e `pnpm lint` retornam exit code 0
- [ ] **Runtime-metric proof** — o 409 de duplicata é observado contra Postgres real: `pnpm --filter @usetheo/skills-api test:integration -t duplicate` retorna exit code 0 e a asserção de status equals 409
- [ ] Cada linha de `## Failure scenarios` foi exercitada e o comportamento esperado observado
- [ ] Os dois snapshots refletem os nomes novos — `grep -c diagnoseDiscoverability tests/repo/core-api-surface.json` retorna 1, e o diff de `core-api-surface.d.ts` foi revisado campo a campo
- [ ] Nenhum PR aberto ficou travado — `gh pr list --state open --json statusCheckRollup` não reporta check `PENDING` sem produtor

### If Validation Fails

1. Separar falhas causadas por este plano das preexistentes (comparar com `git stash` do baseline)
2. Corrigir todas as causadas pelo plano antes de declará-lo completo
3. Reexecutar a cadeia
4. Preexistentes são registradas na descrição do PR e **não** bloqueiam a conclusão

---

## Revision log

### v1.1 — 2026-08-05

Absorve os 9 MUST FIX de `knowledge-base/reviews/english-only-sweep-edge-cases-2026-08-05.md`, mais os 6 SHOULD TEST (como casos RED nas TDD das tarefas existentes) e os 3 DOCUMENT (como notas nos Deep Dives). Nenhuma abstração nova foi introduzida; o delta é de ~15 linhas de código e três parágrafos de procedimento.

| Edge case | Onde | O que mudou |
|---|---|---|
| EC-1 | T0.1 | Catraca compara contra `git merge-base origin/develop HEAD`, não `HEAD` — num evento `pull_request` o checkout é o merge commit, e a catraca era decorativa |
| EC-2 | T0.1 | `fetch-depth: 0` no job `static`; fallback para `PR_BASE_SHA`; pulo **em voz alta** quando a base não resolve |
| EC-3 | T0.1 | Normalização NFD antes de casar + radicais sem acento — sem isso o tier D reportaria 0 com os dois arquivos-alvo da T6.1 intactos |
| EC-4 | T0.1 | `sunset` inválido é rejeitado na entrada, nunca tratado como não-expirado |
| EC-5 | T1.3, T2.1, D3 | Segundo nível de snapshot (`core-api-surface.d.ts`), porque a lista de nomes não vê rename de campo — que é o que a T2.1 faz cinco vezes |
| EC-6 | T4.1 | Versão armazenada ilegível é filtrada e logada, não lançada |
| EC-7 | T4.1 | Violação de unicidade mapeada para 409 reusando `pg-errors.ts:14` — o critério de aceite de T4.2 não era satisfazível sem isso |
| EC-8 | T6.2 | Passos 2 e 7 do procedimento: registrar PRs abertos e propagar `develop` para cada um |
| EC-9 | T5.1–T5.5 | Dois commits por pacote (comentários, depois identificadores) — os dois requisitos da v1.0 não coexistiam |
| EC-10, EC-11 | T1.2 | Caso máximo de três causas; exceção explícita da fórmula de cardinalidade no ramo do rascunho |
| EC-12 | T0.1 | Orçamento malformado falha com mensagem tipada, não `SyntaxError` cru |
| EC-13 | T4.1 | Fronteira do metadado de build (`1.2.0+a` vs `+b`) fixada por teste |
| EC-14 | T5.1–T5.5 | A prova de emit idêntico cobre só `dist/**/*.js`; o `.d.ts` carrega JSDoc e muda legitimamente |
| EC-15 | T1.1 | Asserção escopada à linha de erro, não ao buffer inteiro de stderr |
| EC-16 | (nota) | `paths-ignore` faz commits só de `.md` pularem o CI em `workspace`; o portão roda no PR de promoção — registrado para que a ausência de sinal não seja lida como aprovação |
| EC-17 | T2.1 | Verificado que o contrato JSON **não** muda; registrado para não ser re-litigado nem "corrigido" por precaução |
| EC-18 | T0.1 | `try/catch` por arquivo no scanner; pulados listados na saída |

**Não alterado pela revisão:** o Goal, as sete sub-metas do `## Objective`, o grafo de dependências, e as cinco Unresolved Questions (Q1–Q5) — que seguem abertas e bloqueando T6.3, T2.1, T4.2, T6.2 e T6.1 respectivamente.
