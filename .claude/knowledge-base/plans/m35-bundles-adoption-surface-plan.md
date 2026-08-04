---
slug: m35-bundles-adoption-surface
target_project: theo-skills
milestone_id: M35
created_at: 2026-08-04
goal: Fechar o contrato de leitura de bundles e adoção para que a tela do M35 seja construível e honesta.
---

# Plan: M35 — o contrato que a tela de bundles e adoção precisa

> **Version 1.0** — O M20 entregou bundles e tokens delegados; o M21, telemetria de adoção. Ambos
> `[x]`, ambos sem tela. Este plano **não constrói a tela** — o `CLAUDE.md` deste repositório proíbe
> frontend aqui. Ele fecha as três lacunas que impedem a tela de existir: não há como **listar**
> tokens (só emitir e revogar), a adoção não devolve o **denominador** da janela, e o isolamento
> entre publishers é estrutural e **não testado**.

## Goal

> Enable a tela de distribuição a listar tokens, exibir adoção com denominador e provar isolamento
> entre publishers, medido por `bundle_tokens_are_listable_before_revoking` e
> `adoption_from_another_publisher_is_never_visible` passando na suíte de integração.

## Context

Três lacunas medidas, todas no contrato de leitura.

1. **Não existe `listTokens`.** `packages/api/src/server/store/bundles-store.ts:32-39` declara
   `create`, `get`, `list`, `setItems`, `mintToken` e `revokeToken` — **sem** listagem de tokens. E
   `handlers/publishing.ts` tem `POST .../tokens` (`:147`) e `DELETE .../tokens/:tokenId` (`:180`),
   mas nenhum `GET`. A DoD do M35 exige *"tokens delegados emitidos e revogados pela tela"* — sem
   listar, o operador não sabe **o que** revogar. É a lacuna bloqueante.

2. **A adoção não devolve o denominador.** `handlers/distribution.ts:216-224` responde
   `{ bundle_id, since, adoption: rows }`. O blueprint (D2) concluiu que todo número precisa do total
   ao lado — o peer nunca mostra contagem isolada (`AuditStatistics.tsx:106,117`). Sem o total no
   contrato, a tela o calcula por conta própria e **erra sob paginação**.

3. **O isolamento é estrutural e não provado.** `adoption-store.ts:29-34` afirma que o escopo na
   construção impede *"inclusive o vazamento por diferença de contagem agregada"* — afirmação forte,
   sem teste. O peer investigado **também não tem** teste de isolamento (só de atribuição —
   `test_middleware_user_info.py:27-43`), então não há prior art a copiar: é dívida nossa.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/api/src/server/store/bundles-store.ts` | 171 | `e6dbbe2` (2026-08-01) | CRUD de bundle + emissão/revogação de token | O valor do token **nunca** é persistido em claro — só o hash (`sha256`, linha 41). Listar não pode mudar isso |
| `packages/api/src/server/store/adoption-store.ts` | 79 | `756d6dd` (2026-07-31) | Telemetria de instalação, escopada ao workspace na construção | O escopo estrutural é a garantia de isolamento; nenhuma assinatura pode passar a receber workspace por parâmetro |
| `packages/api/src/server/handlers/publishing.ts` | — | — | Rotas de bundle e token (`:96,104,114,147,180`) | As rotas existentes não mudam de forma; a nova é aditiva |
| `packages/api/src/server/handlers/distribution.ts` | 226 | `8b363d2` (2026-08-01) | `GET /v1/distribution/bundle` e `GET .../adoption` | A resposta atual é aditivamente estendida; `adoption` continua no mesmo lugar |
| `packages/api/tests/integration/m35-bundles-surface.integration.test.ts` (NEW) | 0 | — | (a criar) | — |

### Current callers / dependents

- **Símbolo:** `BundlesStore` — `packages/api/src/server/store/bundles-store.ts:32`
- **Callers (produção):** `handlers/publishing.ts` (`:96,104,114,147,180`), composição em `app.ts`
- **Externo:** não — o contrato público é o HTTP, não a interface do store.

- **Símbolo:** `AdoptionStore.adoption(bundleId, since)` — `adoption-store.ts:23`
- **Callers (produção):** `handlers/distribution.ts:223`
- **Externo (consumido por outro repo):** **sim, indiretamente** — a resposta de
  `GET /v1/bundles/:id/adoption` é lida pelo dashboard. Mudança aditiva.

### Domain glossary

- **bundle** — recorte de skills que um publisher entrega a terceiros.
- **token delegado** — credencial de instalação emitida para um bundle; o valor aparece uma vez.
- **adoção** — contagem de instalações, agregada por **(bundle, skill, versão)** numa janela.
- **publisher** — dono do bundle; o escopo do store é o workspace dele.
- **denominador** — total da janela, contra o qual cada linha ganha proporção.

### Architecture boundaries affected

- **O escopo do store é estrutural** (`rules/architecture.md` — a fronteira decide, não a consulta).
  `createAdoptionStore(db, workspaceId)` e `createBundlesStore(db, workspaceId)` recebem o tenant na
  **construção**; nenhuma mudança deste plano pode movê-lo para parâmetro de método.
- **O contrato de leitura é a fronteira com a tela.** A tela do M33/M35 nunca fala com o store.
- **Segredo não atravessa a fronteira duas vezes.** O token existe em claro apenas na resposta do
  `POST`; a listagem devolve identificador e metadados, nunca o valor.

## Prior Art & Related Work

- **Blueprint interno** — `.claude/knowledge-base/discoveries/blueprints/m35-bundles-adoption-surface-blueprint.md`
  (SHIPPABLE_WITH_CAVEATS 70):
  - `Blueprint §"D2 — Todo número exibido leva denominador"` → Fase 2.
  - `Blueprint §"D3 — Token com exibição única e aviso em texto, sem mecanismo"` → Fase 1, e o que
    a listagem **não** pode devolver.
  - `Blueprint §"Q6"` → Fase 3: o peer não tem teste de isolamento; é dívida nossa.
  - `Blueprint §"Q1"` → a correção da DoD, já aplicada ao `ROADMAP.md`.
- **Blueprint irmão** — `.claude/knowledge-base/discoveries/blueprints/skills-catalog-ux-blueprint.md`,
  cujo ADR D3 teve a premissa corrigida por esta descoberta.
- **Precedente interno** — o M32 estabeleceu o padrão de "este repositório entrega o contrato; a tela
  é de outro repo", com o mesmo formato de nota de fronteira.
- **Sem `*-patterns` skill aplicável** — verificado: `.claude/skills/*-patterns/` não existe.

## Objective

- [ ] Sub-goal 1 — `GET /v1/bundles/:bundleId/tokens` lista tokens sem jamais devolver o valor.
- [ ] Sub-goal 2 — A resposta de adoção devolve o **total da janela**, para a tela ter denominador.
- [ ] Sub-goal 3 — Existe teste que prova que um publisher não vê adoção nem tokens de outro.
- [ ] Sub-goal 4 — Existe teste de que dado controlado pelo cliente não decide atribuição.

## ADRs

### D1 — Listar tokens devolve metadado, nunca valor

**Decisão:** `GET /v1/bundles/:bundleId/tokens` devolve `token_id`, `label`, `created_at`,
`expires_at`, `revoked_at` e `quota_per_window` — **jamais** o valor nem o hash.

**Rationale:** `Blueprint §"D3"` — o peer exibe o segredo uma única vez, na criação
(`TokenGeneration.tsx:366`), e depois só o identificador. O hash também não sai: devolvê-lo
transformaria a listagem numa superfície de ataque offline sem nenhum ganho para a tela.

**Alternativas consideradas:**

1. **Devolver valor mascarado (`tok_...abc`).** Rejeitada: sugere que o valor é recuperável e convida
   à tentativa. O peer não faz, e o M35 pede o contrário.
2. **Não listar; a tela guarda o que emitiu.** Rejeitada: token emitido por outro operador, ou por
   CLI, ficaria invisível — e revogar o que não se enxerga é impossível.

**Consequências:** o `BundlesStore` ganha `listTokens`; o teste assere que nenhum campo da resposta
casa com o valor emitido.

### D2 — O denominador vem do servidor, não da tela

**Decisão:** a resposta de adoção passa a incluir `total_installs` da janela, ao lado das linhas.

**Rationale:** `Blueprint §"D2"` — o peer sempre exibe valor absoluto **e** proporção
(`AuditStatistics.tsx:106,117`). Se a tela somar as linhas que recebeu, o denominador fica errado
assim que houver paginação ou corte de top-N.

**Alternativas consideradas:**

1. **A tela soma as linhas.** Rejeitada pelo motivo acima — erra em silêncio, que é o pior modo.
2. **Devolver só a proporção, sem absolutos.** Rejeitada: esconde escala; 100% de 2 instalações não é
   100% de 2000.

**Consequências:** uma agregação a mais por requisição. O custo não foi medido com volume real
(`Blueprint §"Limites"`), e o plano registra isso em vez de otimizar às cegas.

### D3 — O isolamento ganha teste, mesmo sem prior art

**Decisão:** escrever teste de integração que cria dois workspaces com adoção e tokens, e assere que
cada um enxerga **apenas** o seu.

**Rationale:** `Blueprint §"Q6"` — o peer não tem esse teste; os dele provam **atribuição**
(`test_middleware_user_info.py:27-43`), não isolamento. Nossa garantia é estrutural e mais forte, mas
"mais forte que um peer que não testa" é barra baixa. É a mesma lição do M32: garantia estrutural sem
teste é convenção.

**Alternativas consideradas:**

1. **Confiar na construção escopada.** Rejeitada: foi exatamente esse raciocínio que, no M32, deixou
   passar um teste que não discriminava.
2. **Testar só na unidade do store.** Rejeitada: o vazamento que importa é o do **endpoint**, e ele
   passa por resolução de principal, que o teste de unidade não exercita.

**Consequências:** o teste precisa de dois workspaces reais no mesmo banco — e é justamente por isso
que ele prova algo.

## Dependencies

**Nenhuma dependência nova é adicionada por este plano.**

| Package | Versão | Nova? | Rule 9 — por que não adicionamos |
|---|---|---|---|
| `drizzle-orm` | já declarada | Não | A listagem e o total usam o que já existe |
| `zod` | já declarada | Não | O contrato de resposta entra no schema existente |
| — lib de agregação/analytics | — | **Rejeitada** | `parsimony-ladder` rung 2/4: um `COUNT` a mais é SQL, não biblioteca |

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Listar tokens amplia a superfície: quem lê a lista sabe quantas credenciais existem e quando expiram | **Alta** | A rota herda o mesmo gate das demais (`publica`), o valor nunca sai, e a listagem é escopada ao workspace. Superfície nova **declarada**, não reduzida a zero | implementador |
| `total_installs` é uma agregação a mais por requisição, com custo não medido | Média | Registrado como item a medir com volume real (`Blueprint §"Limites"`); não otimizar antes de medir | implementador |
| O teste de isolamento pode passar por construção sem provar nada, como no M32 | **Alta** | O teste deve ser **provado discriminante**: quebrar o escopo temporariamente e confirmar que reprova | implementador |
| A tela não é entregue aqui — o M35 continua incompleto do ponto de vista do usuário | **Alta** | Declarado como nota de fronteira, igual ao M32. A aceitação registrará o critério de tela como `not_exercised` | autor do plano |
| O M35 declara M31 como dependência, e o M31 está `[ ]` | **Alta** | Este plano entrega só o eixo de contrato, que **não** depende do padrão de tela do M31. A tela, que depende, fica fora | autor do plano |

## Unresolved Questions

- Q1 — `listTokens` deve devolver tokens **revogados**? Proposta: sim, com `revoked_at` preenchido —
  esconder o histórico impediria auditar o que já foi emitido. Decisão de produto.
- Q2 — O `total_installs` conta instalações **do bundle** ou a soma das linhas devolvidas? São
  diferentes quando houver top-N. Proposta: do bundle inteiro na janela, e a tela dirá isso.
- Q3 — A janela padrão é 30 dias (`distribution.ts:221`). Isso deve aparecer no contrato de resposta
  para a tela não repetir a constante? Proposta: sim, já vem `since`.

## Dependency Graph

```
Fase 1 (listTokens: store + rota)
   │
   ├──▶ Fase 3 (testes: isolamento + atribuição)
   │
Fase 2 (denominador na adoção) ──▶ Fase 3
                                      │
                                      ▼
                              Fase 4 (Integration Validation)
```

Fases 1 e 2 são independentes e podem paralelizar. A 3 depende das duas.

---

## Phase 1: Listar tokens sem vazar valor

### T1.1 — `listTokens` no store e a rota que o expõe

#### Objective
Permitir que a tela saiba **o que** revogar, sem jamais receber o valor do token.

#### Why this step (action + reasoning)

**O que faz:** acrescenta `listTokens(bundleId)` ao `BundlesStore` e registra
`GET /v1/bundles/:bundleId/tokens` em `publishing.ts`, ao lado das rotas de token que já existem.

**Por que agora:** é a lacuna bloqueante do M35 — a DoD pede revogar pela tela, e revogar o que não
se enxerga é impossível. Decisão D1.

#### Evidence
- `packages/api/src/server/store/bundles-store.ts:32-39` — a interface tem `mintToken` e `revokeToken`, **sem** listagem.
- `packages/api/src/server/handlers/publishing.ts:147,180` — `POST` e `DELETE` de token existem; nenhum `GET`.
- `Blueprint §"D3"` e `TokenGeneration.tsx:366` — o valor aparece uma vez e nunca mais.
- `packages/api/src/server/store/bundles-store.ts:41` — `sha256` confirma que só o hash é persistido.

#### Files to edit
```
packages/api/src/server/store/bundles-store.ts — listTokens
packages/api/src/server/handlers/publishing.ts — GET /v1/bundles/:bundleId/tokens
packages/api/tests/integration/m35-bundles-surface.integration.test.ts (NEW) — RED primeiro
```

#### Deep file dependency analysis
- `bundles-store.ts` (Baseline: 171 LoC, `e6dbbe2`) — a invariante do Baseline é que o valor do token
  nunca é persistido em claro. `listTokens` **não** pode devolver o hash: ele é material para ataque
  offline e inútil para a tela.
- `publishing.ts` — a rota nova herda o mesmo middleware `publica` das irmãs; não inventa gate.

#### Deep Dives
- **Campos devolvidos:** `token_id`, `label`, `created_at`, `expires_at`, `revoked_at`,
  `quota_per_window`. Nada mais.
- **Edge case:** bundle sem tokens → lista vazia, não 404. Ausência de token não é ausência de bundle.
- **Edge case:** token expirado → aparece, com `expires_at` no passado. Esconder impediria entender
  por que uma instalação parou de funcionar.
- **Negative case:** bundle de outro workspace → **404**, não 403 — mesmo contrato de não-enumeração
  do M11.
- **Q1 é pré-requisito:** decidir se revogados aparecem antes de implementar.

#### Pseudo-code / Signatures

```pseudocode
interface TokenView { tokenId, label?, createdAt, expiresAt, revokedAt?, quotaPerWindow? }
listTokens(bundleId: string): Promise<TokenView[]>   -- escopado ao workspace na construção

GET /v1/bundles/:bundleId/tokens
  -> 200 { bundle_id, tokens: TokenView[] }
  -> 404 quando o bundle não é do workspace

# Example
input:  GET /v1/bundles/b_1/tokens
output: { "bundle_id": "b_1", "tokens": [
           {"token_id":"tok_a","label":"ci","created_at":"…","expires_at":"…","revoked_at":null} ] }
```

#### Tasks
1. Responder Q1 (revogados aparecem?).
2. Testes RED: lista sem valor nem hash; bundle vazio → lista vazia; outro workspace → 404.
3. `listTokens` no store.
4. Rota em `publishing.ts` com o middleware `publica`.

#### TDD
```
RED:     tokens_are_listable_before_revoking() — o token emitido aparece na listagem
RED:     listing_never_returns_the_secret_value() — nenhum campo casa com o valor devolvido no POST
RED:     listing_never_returns_the_hash() — nem o sha256 persistido
RED:     bundle_without_tokens_returns_empty_list_not_404()
RED:     bundle_from_another_workspace_returns_404()
GREEN:   Implementar store + rota
REFACTOR: Nenhum esperado
VERIFY:  cd packages/api && THEOSKILL_PG_URI=… npx vitest run --config vitest.integration.config.ts m35-bundles
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] A resposta não contém o valor do token nem o hash — asseverado por comparação direta
- [ ] Bundle de outro workspace devolve 404
- [ ] Pass: lint + typecheck; `bundles-store.ts` ≤ 500 linhas

#### DoD
- [ ] `pnpm test:integration` verde
- [ ] CHANGELOG `[Unreleased]` atualizado

---

## Phase 2: O denominador da adoção

### T2.1 — `total_installs` na resposta de adoção

#### Objective
Devolver o total da janela para a tela exibir proporção sem calculá-la errado.

#### Why this step (action + reasoning)

**O que faz:** o `AdoptionStore` ganha o total da janela para o bundle, e o handler o inclui na
resposta.

**Por que agora:** é a condição para o critério corrigido da DoD ("todo número com o denominador ao
lado"). Decisão D2.

#### Evidence
- `packages/api/src/server/handlers/distribution.ts:216-224` — a resposta atual é `{ bundle_id, since, adoption }`, sem total.
- `Blueprint §"D2"` e `AuditStatistics.tsx:106,117` — o peer nunca exibe contagem sem denominador.
- `ROADMAP.md` § M35, critério 2 (corrigido em 2026-08-04).

#### Files to edit
```
packages/api/src/server/store/adoption-store.ts — total da janela
packages/api/src/server/handlers/distribution.ts — total_installs na resposta
packages/api/tests/integration/m35-bundles-surface.integration.test.ts — RED primeiro
```

#### Deep file dependency analysis
- `adoption-store.ts` (Baseline: 79 LoC) — a invariante é o escopo estrutural: a nova função também
  recebe o workspace da **construção**, nunca por parâmetro.
- Downstream: a resposta HTTP é lida pelo dashboard; mudança **aditiva**.

#### Deep Dives
- **Q2 é pré-requisito:** o total é do bundle inteiro ou a soma das linhas? Sem decidir, a tela mostra
  proporção que não fecha 100% e ninguém entende por quê.
- **Edge case:** janela sem instalação → `total_installs: 0` e `adoption: []`. A tela precisa
  distinguir "ninguém instalou" de "não consegui ler".
- **Edge case:** divisão por zero na tela — o contrato devolver 0 explícito evita `NaN`.

#### Tasks
1. Responder Q2.
2. Testes RED: total presente; total zero com lista vazia; total ≥ soma das linhas.
3. Implementar no store e no handler.

#### TDD
```
RED:     adoption_response_carries_the_window_total()
RED:     empty_window_returns_zero_total_and_empty_rows() — distinto de erro
RED:     total_is_not_smaller_than_the_sum_of_returned_rows() — pega o caso do top-N
GREEN:   Implementar
REFACTOR: Nenhum esperado
VERIFY:  npx vitest run --config vitest.integration.config.ts m35-bundles
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `total_installs` presente em toda resposta de adoção
- [ ] Janela vazia devolve `0` explícito, não campo ausente
- [ ] Pass: lint + typecheck

#### DoD
- [ ] `pnpm test:integration` verde
- [ ] CHANGELOG atualizado

---

## Phase 3: Provar o isolamento que hoje é só estrutural

### T3.1 — Um publisher nunca vê o do outro

#### Objective
Transformar a garantia estrutural de isolamento em teste que reprova se ela for quebrada.

#### Why this step (action + reasoning)

**O que faz:** cria dois workspaces com bundles, tokens e adoção, e assere que cada um enxerga apenas
o seu — em adoção **e** em listagem de tokens.

**Por que agora:** o comentário do store faz uma afirmação de segurança forte
(`adoption-store.ts:29-34`) que nada verifica. O peer não tem esse teste (`Blueprint §"Q6"`), então
não há prior art — é dívida nossa, e o M32 já mostrou o custo de deixar garantia estrutural sem
prova. Decisão D3.

#### Evidence
- `packages/api/src/server/store/adoption-store.ts:29-34` — a afirmação de que o escopo impede "inclusive o vazamento por diferença de contagem agregada".
- `Blueprint §"Q6"` — os testes do peer provam **atribuição**, não isolamento.
- Precedente do M32: o teste de regressão do Goal não discriminava, e só a injeção de falha revelou.

#### Files to edit
```
packages/api/tests/integration/m35-bundles-surface.integration.test.ts — os testes de isolamento
```

#### Deep Dives
- **O teste precisa ser provado discriminante.** Como no M32: quebrar o escopo temporariamente
  (passar o workspace do outro na construção do store) e confirmar que **reprova**. Sem essa prova, o
  teste pode estar passando por construção.
- **Dois eixos:** adoção **e** tokens. Um vazamento em qualquer um é vazamento.
- **Negative case do `tokenId`:** aplicar a classe de teste que o peer tem
  (`test_ignores_forgeable_headers`) — dado controlado pelo cliente não decide atribuição.

#### Tasks
1. Semear dois workspaces com dados distintos.
2. Testes RED de isolamento em adoção e em tokens.
3. Provar discriminância (quebrar escopo → reprova → restaurar).
4. Confirmar `git diff --exit-code` limpo após a prova.

#### TDD
```
RED:     adoption_from_another_publisher_is_never_visible()
RED:     tokens_from_another_publisher_are_never_listable()
RED:     install_event_attribution_does_not_come_from_client_controlled_field()
GREEN:   (a garantia já existe; o entregável é o teste)
REFACTOR: Nenhum esperado
VERIFY:  npx vitest run --config vitest.integration.config.ts m35-bundles
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Os testes foram **provados discriminantes** (reprovam quando o escopo é quebrado)
- [ ] `git diff --exit-code` limpo após a prova
- [ ] Isolamento coberto nos dois eixos: adoção e tokens
- [ ] Pass: lint + typecheck

#### DoD
- [ ] `pnpm test:integration` verde
- [ ] CHANGELOG atualizado

---

## Coverage Matrix

| # | Gap / Requirement (DoD do M35, corrigida) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Bundles gerenciáveis pela tela — listar, criar, editar itens | out-of-scope (entregue no M20) | `POST /v1/bundles`, `GET /v1/bundles`, `PUT .../items` entregues no M20; este plano não os altera |
| 2 | Adoção visível com a granularidade correta e **denominador** | T2.1 | `total_installs` na resposta; o rótulo correto é da tela (M33/theo-cloud) |
| 3 | Tokens emitidos **e revogados** pela tela | T1.1 | `GET .../tokens` — a lacuna bloqueante: sem listar não há o que revogar |
| 4 | Nenhum segredo relegível | T1.1 | A listagem devolve identificador e metadados; teste assere que nem valor nem hash saem |
| 5 | Alcançável por clique | out-of-scope (D-fronteira: é tela, outro repositório) | É tela; nota de fronteira abaixo |
| 6 | Isolamento entre publishers (risco declarado do milestone) | T3.1 | Teste que reprova se o escopo for quebrado |

**Coverage: 6/6 requisitos endereçados (100%)**

> **Nota de fronteira.** Os critérios 1 e 5 da DoD falam de tela. A tela nasce em
> `theo-cloud/dashboard` — o `CLAUDE.md` deste repositório proíbe frontend aqui. O critério 1 já tem
> contrato completo desde o M20; o 5 é renderização, e o `/acceptance M35` o registrará como
> `not_exercised`, exatamente como o M32 fez com o seu critério de tela. Este plano entrega a
> **condição necessária**, e diz isso antes de começar em vez de descobrir depois.

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] `pnpm test` e `pnpm test:integration` verdes
- [ ] `pnpm typecheck` e `pnpm lint` limpos
- [ ] Orçamento de 500 LoC por arquivo respeitado
- [ ] `CHANGELOG.md` atualizado sob `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade preservada: as respostas existentes são estendidas, nunca alteradas
- [ ] Q1, Q2 e Q3 respondidas ou explicitamente adiadas com registro
- [ ] **Os testes de isolamento foram provados discriminantes**, não apenas verdes

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:skills` (DB) | conexão cai durante a listagem de tokens | derrubar a conexão no meio | Erro tipado ao chamador; nenhuma resposta parcial que pareça "não há tokens" |
| `postgres:skills` (DB) | agregação do total falha, linhas retornam | mock que faz a segunda consulta lançar | A resposta **falha inteira** — devolver linhas sem total daria à tela um denominador ausente e um gráfico errado |
| `postgres:skills` (DB) | janela sem eventos | banco limpo | `total_installs: 0` e `adoption: []`, distinguível de erro |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** provar as três lacunas fechadas contra banco real.

### Execution

```
pnpm typecheck
pnpm lint
pnpm test
pnpm compose:up && pnpm db:migrate && pnpm test:integration
```

### Acceptance Criteria

- [ ] Todas as suítes verdes
- [ ] Cobertura ≥ 90% nos arquivos alterados
- [ ] Zero erros de tipo e zero avisos de lint
- [ ] Toda linha de `## Failure scenarios` exercitada
- [ ] Os testes de isolamento **reprovam** quando o escopo é quebrado

### If Validation Fails

1. Separar falhas deste plano das pré-existentes (`webhook-delivery` e `trace-propagation` são conhecidas)
2. Corrigir todas as causadas por este plano
3. Re-rodar a cadeia
