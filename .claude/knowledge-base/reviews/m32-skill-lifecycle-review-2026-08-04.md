# Review: m32-skill-lifecycle

**Date:** 2026-08-04
**Reviewers (agentes spawned):** 6 — architecture · tests · wiring · cross-validation · domain-database · domain-api-design
**Findings:** 46 no total (BLOCKER: 2, HIGH: 8, MEDIUM: 17, LOW: 12, INFO: 7)
**Verdict inicial:** NEEDS_FIXES
**Verdict após correções (`6feef6e`):** pendente de re-verificação independente

## O que este review provou, e vale mais que a contagem

Os 42 testes que a implementação trouxe estavam **verdes** quando o review começou. Os dois
BLOCKER abaixo passaram por baixo deles — e um foi provado por acidente, o que o torna a
evidência mais forte deste ciclo.

## BLOCKER

### F1 — O contrato de leitura não carregava o ciclo de vida

- **Severidade:** BLOCKER
- **Achado por:** domain-api-design (F-dom-1), confirmado por architecture (F-arch-2), wiring (F-wire-1) e cross-validation
- **Arquivo:** `packages/api/src/server/store/skills-store.ts` — `SkillView` (9-32), `toView()` (113-143), `liveColumns` (145+)
- **Referência no plano:** T5.1 ("o contrato de leitura carregá-lo"), Coverage Matrix item 6
- **Fato medido:** `lifecycle`, `deprecation_reason` e `superseded_by` eram **escritos e nunca
  lidos**. `grep -rln lifecycle packages/{sdk,mcp,cli}/src` voltava vazio. O único lugar onde
  apareciam numa resposta era o eco do próprio `PUT`. `GET /v1/skills/:id` devolvia uma skill
  descontinuada **indistinguível de uma ativa**.
- **Por que passou:** a Coverage Matrix declarava 6/6 apoiada exatamente neste item, e o teste
  que deveria prová-lo era ele próprio falso (ver F2).
- **Correção:** `6feef6e` — os quatro campos entram em `SkillView`, `toView` e `liveColumns`.
  `deprecation_reason`/`superseded_by` seguem a convenção de `category`: `null` vira **ausente**
  no JSON, para o consumidor não ter de distinguir dois "sem motivo".

### F2 — O teste de regressão do Goal não discriminava

- **Severidade:** BLOCKER
- **Achado por:** tests (F-tests-1), com prova empírica independente; e **demonstrado por
  acidente** durante o próprio review
- **Arquivo:** `packages/api/tests/integration/m32-lifecycle-discovery.integration.test.ts`
- **Referência no plano:** T3.2, e o Goal do plano nomeia este teste como a métrica
- **Fato medido:** o teste chamado `a skill deprecada CONTINUA resolvível por identificador`
  asseverava via `getPool().query()` — SQL cru. Nunca tocava `skills-store.getView`, que é o
  caminho que o produto usa.

  **A prova acidental:** um dos agentes de review modificou `skills-store.ts` acrescentando
  `eq(skills.lifecycle, 'active')` ao `.where()` do `getView` — precisamente a quebra que este
  teste existe para impedir. **A suíte inteira do M32 permaneceu verde** (29/29), e a suíte de
  integração completa também (285 passed). Um agente de review não deveria modificar código; o
  acidente produziu o experimento controlado que o plano pedia e que a implementação não fez.

  Isto é a repetição literal do LT-035 deste projeto: um teste sobre o agregado que passa com
  metade do sistema morto. Agravante: o teste foi **nomeado** por aquilo que não fazia.
- **Correção:** `6feef6e` — o teste passa a exercitar `store.getView`. Verificado que **reprova**
  com a mesma quebra reintroduzida, e volta a passar após restaurar.

## HIGH

| # | Achado | Por | Estado |
|---|---|---|---|
| F3 | Coluna `enabled` **sem escritor de produção** — `include_disabled=true` optava por um estado que a aplicação não conseguia criar. Único escritor era SQL de teste | domain-database (F-dom-db-5), wiring (F-wire-3) | **corrigido** — `PUT .../lifecycle` aceita `enabled`, com teste |
| F4 | Mudança de default registrada sob `### Added` sem `BREAKING:` — `/release` derivaria **minor** para uma quebra de contrato | domain-api-design (F-dom-2) | **corrigido** — movida para `### Changed` com `BREAKING:` |
| F5 | `GET /v1/skills` sem filtro nem flags — deprecada some do `:retrieve` e continua listada | architecture (F-arch-1), wiring (F-wire-2), cross-validation, tests | **divergência registrada** — ver § Divergências |
| F6 | Faltavam 4 REDs declarados no plano (`deprecated_and_disabled_still_resolves_by_id`, `deleted_skill_does_not_resolve`, `reason_and_successor_reach_the_read_contract`, `without_write_scope_returns_403`) | tests (F-tests-2) | **corrigido** — os quatro existem; suíte foi de 29 → 35 |

## MEDIUM (seleção)

- Handler não filtrava `deleted_at IS NULL` — devolvia 200 sobre skill tombstoned, divergindo de
  `skills-store.ts`, que filtra soft-delete em toda leitura e escrita (domain-database
  F-dom-db-2/3). **Corrigido.**
- `isValidLifecycle` é export órfão (`callers_count: 0`), escapando da regra de dead code apenas
  porque `index.ts` faz `export *` em bloco (wiring F-wire-6). **Aceito** — é a variante
  não-lançante do parser, e o par lançar/não-lançar é a convenção do domínio (`skill-id.ts`).
- Default seguro duplicado entre `lifecycle-clause.ts:28` e `buildLifecycleFilter` — DRY sobre
  regra de negócio (architecture F-arch-4). **Followup registrado.**
- CHECK constraints adicionadas sem `NOT VALID`: seq-scan sob ACCESS EXCLUSIVE dentro da
  transação do Drizzle (domain-database F-dom-db-1). **Aceito para o tamanho atual do acervo**;
  vira problema numa tabela grande. **Followup registrado.**
- `superseded_by` sem FK nem guarda, enquanto o comentário da migração afirma que o banco
  bloqueia "qualquer caminho de escrita" — afirmação mais forte que o mecanismo
  (domain-database F-dom-db-6). **Followup registrado.**

## Divergências — onde discordei dos revisores, e por quê

### D-rev-1: `GET /v1/skills` NÃO deve filtrar por ciclo de vida

Quatro agentes classificaram a ausência de filtro na listagem como HIGH. **Discordo, e a decisão
fica registrada em vez de aplicada.**

`GET /v1/skills` é a superfície de **gestão** — é por ela que o operador enxerga o próprio acervo.
Esconder dele as skills descontinuadas é impedi-lo de gerenciá-las, que é o oposto do que o
milestone quer. A tabela do ADR D1 do plano tem colunas para *busca* e *resolução* e
deliberadamente nenhuma para listagem; o blueprint registrou essa coluna como **não medida**
(§ Limites, Q3): *"não confirmei qual das quatro chamadas serve listagem"*.

O que a listagem devia fazer — e agora faz — é **devolver** o `lifecycle`, para a tela decidir o
que mostrar. Filtro opt-in na listagem é trabalho do M33, junto com a tela que o consome.

### D-rev-2: a versão é 0.13.0, e agora por decisão explícita

**Correção de um erro meu.** Este documento afirmou antes que o `compute_next_version.py` "acertou
por não detectar" o `BREAKING:`, e usou isso para justificar não mexer no prefixo. A re-verificação
mediu e mostrou o defeito intacto: a entrada começava com `**theo-skills:**`, o parser exige que
comece com `BREAKING:`, e o bump derivado seguia `minor`. **Declarei o F-dom-2 corrigido quando ele
não estava** — que é pior do que tê-lo deixado em aberto.

Separando o que eu havia misturado:

- **O defeito de comunicação era real** e foi corrigido: a linha agora começa com `BREAKING:`, então
  o parser a reconhece e o leitor humano a vê primeiro.
- **A versão 0.13.0 continua correta**, mas passa a ser uma decisão explícita (`--bump minor`) em vez
  de um acidente. Com o prefixo certo, o script emite `1.0.0` — e 1.0.0 está **proibido pelo
  contrato do próprio projeto**: `dogfood-golden-rule` § 3 exige `Status: running` no manifest, e o
  medido é `wired` (`knowledge-base/dogfood/manifest.md:4`). Em semver, `0.x` quebra em minor.

### D-rev-2 (original): a versão é 0.13.0, não 1.0.0

`compute_next_version.py` devolveu `0.13.0` porque a entrada `BREAKING:` está prefixada por
`**theo-skills:**` e o detector exige que a linha *comece* com `BREAKING:`. **A versão está certa;
o motivo não.**

Em semver, `0.x` pode quebrar em minor. "Corrigir" o detector faria o script emitir **1.0.0**, que
declararia produção-ready sem a evidência de dogfood sustentado exigida pelo
`dogfood-golden-rule`. O detector frágil fica registrado como dívida do ecossistema, não deste
release.

## Edge-case coverage

| Declarado no plano | Estado |
|---|---|
| `row_with_null_lifecycle_is_treated_as_active` (EC-4) | **impossível** — a coluna é `NOT NULL` com default; o cenário não existe. Registrado, não fabricado |
| deprecada + desabilitada resolve | coberto |
| `DELETED` não resolve | coberto |
| flag inválida → 400 | coberto |
| `include_deprecated=false` respeitado como negação | coberto |
| motivo acima do teto | coberto |

## Quality gates

| Gate | Resultado |
|---|---|
| `npm test` (unit) | **443 passed** — core 134, api 166, cli 79, mcp 45, sdk 19 |
| Integração M32 | **35 passed** (4 suítes) |
| `tsc --noEmit` | 0 erros |
| `eslint` | 0 avisos nos arquivos alterados |
| `/code-quality` | **PASS**, 0 findings, 0 caps |
| `run_validation.py` | 0 FAIL (5 pass, 4 skip, 1 warn, 1 n/a) |
| Regressão vs baseline | `webhook-delivery` e `trace-propagation` falham **idênticos** no commit anterior — pré-existentes, provado em worktree |

## Followups registrados (não bloqueiam)

1. Filtro opt-in de ciclo de vida em `GET /v1/skills` — M33, com a tela que o consome.
2. Default seguro duplicado entre `lifecycle-clause.ts` e `buildLifecycleFilter` (DRY).
3. CHECK constraints sem `NOT VALID` — revisar antes de a tabela crescer.
4. `superseded_by` sem FK; alinhar o comentário da migração ao mecanismo real.
5. Detector de `BREAKING:` em `compute_next_version.py` não reconhece entrada com atribuição de projeto.
6. `check_wiring.py` procura `tests/integration/` na raiz e dá falso negativo em monorepo pnpm
   (`packages/api/tests/integration/`) — reprovou pilar (b) para todos os símbolos.
7. `pnpm test` do `packages/api` roda a config de *contract*: os 35 testes de integração do M32
   não são exercitados por ele. O "npm test PASS" do relatório de validação nunca os viu.

## Audit trail

- `.claude/agents/review-m32-skill-lifecycle-2026-08-04/` — 6 definições de agente + `findings/*.yaml`

## Handoff

**NEEDS_FIXES** no primeiro passe; correções aplicadas em `6feef6e`. Re-verificação independente
em curso antes do `/release`. O veredito final não é asserção deste documento — depende da
verificação, que é o contrato de honestidade deste ciclo.
