---
slug: m32-skill-lifecycle
target_project: theo-skills
milestone_id: M32
created_at: 2026-08-03
goal: Deprecar uma skill sem quebrar quem já a referencia — some da descoberta, continua resolvível.
---

# Plan: M32 — ciclo de vida da skill

> **Version 1.1** — revisado por `/edge-case-plan` (2026-08-03), absorvendo EC-1 a EC-3 de
> `.claude/knowledge-base/reviews/m32-skill-lifecycle-edge-cases-plan-2026-08-03.md`. A correção
> maior (EC-1) resolve uma **contradição interna do v1.0**: ele exigia um teste que rejeita valor
> fora do vocabulário e ao mesmo tempo declarava a coluna como `text()` sem constraint — o mesmo
> anti-exemplo que dizia estar corrigindo. Ver ADR **D5**.
>
> O registro hoje só sabe `ACTIVE` e `DELETED`, e apagar **reserva o
> identificador**, quebrando quem referencia a skill. Este plano introduz o estágio de ciclo de vida
> (`active` · `draft` · `deprecated`) como dimensão **ortogonal** à habilitação e à exclusão, com uma
> garantia central: o filtro vive **apenas** no caminho de busca, de modo que a deprecada some da
> descoberta e continua resolvível por id. A garantia é provada por teste de regressão — que é
> justamente o que o peer investigado **não** tem.

## Goal

> Enable o operador a **deprecar** uma skill de modo que ela deixe de aparecer em
> `GET /v1/skills:retrieve` por padrão **e continue resolvível** por `GET /v1/skills/:id`, medido por
> `deprecated_skill_still_resolves_by_id` passando e por `deprecated_skill_absent_from_retrieve_by_default`
> passando na mesma suíte.

## Context

Três fatos medidos motivam este milestone.

1. **Não há vocabulário para "não use mais esta".** `packages/core/src/infrastructure/db/schema.ts:71`
   declara `state: text('state').notNull().default('ACTIVE')`, e o único outro valor escrito é
   `'DELETED'` (`packages/api/src/server/store/skills-store.ts:397`, que grava também `deletedAt` e
   `reservedUntil`). Retirar de circulação hoje significa apagar — e apagar **reserva o id**.

2. **O acervo já tem o problema.** A aceitação do M31 leu o workspace de dev e encontrou uma skill que
   se descreve como *"pode ser removida"* e outra publicada e invisível à busca. Não há como
   sinalizar nem uma nem outra.

3. **Existe prior art, e ela é específica.** O blueprint `m32-skill-lifecycle` (SHIPPABLE_WITH_CAVEATS
   89) mediu num registry real: o filtro de estado vive **só** no repositório de busca
   (`search_repository.py:1344,1733,2097,2355`) e a leitura por id não o aplica
   (`skill_repository.py:190-197`). É essa separação de caminhos que faz a deprecação não quebrar
   consumidor.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/skill-lifecycle.ts` (NEW) | 0 | — | (a criar — vocabulário + validação tipada) | — |
| `packages/core/src/domain/skill-lifecycle.test.ts` (NEW) | 0 | — | (a criar — RED primeiro) | — |
| `packages/core/src/infrastructure/db/schema.ts` | 441 | `f95749d` (2026-07-31) | Schema Drizzle — `skills` com `state`, `visibility`, `searchText`, embedding | `state` e `deletedAt`/`reservedUntil` continuam com a semântica atual; migração **aditiva** |
| `packages/core/src/contract/index.ts` | 130 | `e6dbbe2` (2026-08-01) | Contrato Zod compartilhado (`OperationStateSchema` etc.) | `OperationState` é de **operação**, não de skill — não confundir nem reaproveitar |
| `packages/core/src/domain/retrievers/types.ts` | 93 | `294850f` (2026-08-03) | Porta do retriever + `MatchedLeg` | `matched` é contrato público (SDK/MCP/dashboard) — só mudança aditiva |
| `packages/api/src/server/store/skills-store.ts` | 419 | `294850f` (2026-08-03) | Persistência de skills; soft-delete na linha 397 | A leitura por id **não** ganha filtro de ciclo de vida (é a garantia do milestone) |
| `packages/api/src/server/handlers/skills.ts` | 497 | `e5386a5` (2026-08-03) | Handlers REST de skill | Já perto do teto de 500 LoC — o handler novo vai para arquivo próprio |
| `packages/api/src/server/handlers/retrieve.ts` | 117 | `4810eed` (2026-08-03) | Handler de `:retrieve`, já conta `matched_vector`/`matched_keyword` | As métricas existentes continuam emitindo |
| `packages/api/src/server/handlers/lifecycle.ts` (NEW) | 0 | — | (a criar — `PUT /v1/skills/:id/lifecycle`) | — |
| `packages/core/src/infrastructure/db/migrations/0014_*.sql` (NEW) | 0 | — | (a criar por `pnpm db:generate`) | Última migração hoje é `0013_wild_invisible_woman.sql` |

### Current callers / dependents

- **Símbolo:** `skills.state` (coluna) — `packages/core/src/infrastructure/db/schema.ts:71`
- **Callers (produção):** `packages/api/src/server/store/skills-store.ts:251` (escreve `'ACTIVE'`), `:397` (escreve `'DELETED'`), `:147` (projeta em `SELECT`)
- **Callers (testes):** suíte de `skills-store`
- **Externo:** o valor **não** é exposto no contrato de leitura hoje — o que dá liberdade para
  introduzir o estágio sem quebrar consumidor.

- **Símbolo:** `RetrievedSkill` / `MatchedLeg` — `packages/core/src/domain/retrievers/types.ts:62,68`
- **Callers (produção):** `hybrid-retriever.ts:62,77,101,111`; `handlers/retrieve.ts:95-96`
- **Externo (consumido por outros repos):** **sim** — resposta de `GET /v1/skills:retrieve`, lida por
  SDK, MCP e dashboard. Toda mudança aqui é aditiva por contrato.

### Domain glossary

- **estágio (lifecycle)** — `active` · `draft` · `deprecated`. Editorial: diz o que a skill *é* no
  ciclo de publicação.
- **habilitação** — liga/desliga operacional, reversível, sem juízo editorial.
- **exclusão (`state`)** — `ACTIVE`/`DELETED` já existente; soft-delete que **reserva o id**.
- **resolução** — obter a skill/instrução por identificador. Caminho que o consumidor já integrado usa.
- **descoberta** — `:retrieve` e listagem. Caminho de quem ainda não conhece a skill.
- **sucessora (`supersededBy`)** — identificador da skill que substitui a deprecada. Opcional.

### Architecture boundaries affected

- **Domínio define, infraestrutura implementa** (`rules/architecture.md` § 2 — DIP). O vocabulário e a
  validação nascem em `packages/core/src/domain/`, sem import de Drizzle nem de HTTP. O store
  consome.
- **Três dimensões ortogonais convivem** — estágio, habilitação e exclusão. O plano **não** funde
  nenhuma delas; a tabela de convivência está em D1.
- **O filtro atravessa a fronteira em um só sentido:** busca aplica, resolução não. Essa assimetria é
  a arquitetura do milestone, não um detalhe de implementação.

## Prior Art & Related Work

- **Blueprint interno** — `.claude/knowledge-base/discoveries/blueprints/m32-skill-lifecycle-blueprint.md`
  (SHIPPABLE_WITH_CAVEATS 89). Consumido aqui:
  - `Blueprint §"D1 — Adotar duas dimensões ortogonais, não um enum único"` → Fase 1.
  - `Blueprint §"D2 — Filtrar na busca, nunca na resolução por id"` → Fase 3, e é o Goal.
  - `Blueprint §"D3 — Motivo e sucessora são nossos a desenhar"` → Fase 5.
  - `Blueprint §"D4 — Validar valor agora; máquina de transições só com caso concreto"` → Fase 1,
    e o trade-off que a DoD do M32 pedia reconciliar (ver ADR D4 abaixo).
  - `Blueprint §"Q6"` → Fase 2 (migração aditiva; semântica portável, mecanismo não).
- **Blueprint irmão** — `.claude/knowledge-base/discoveries/blueprints/skills-catalog-ux-blueprint.md`
  § "Q2", que trouxe o achado inicial de ortogonalidade e a recomendação R7.
- **Sem `*-patterns` skill aplicável** — verificado: `.claude/skills/*-patterns/` não existe.

## Objective

- [ ] Sub-goal 1 — O domínio tem vocabulário fechado de estágio, com erro tipado para valor inválido.
- [ ] Sub-goal 2 — A migração é aditiva: toda skill existente vira `active`; nenhum consumidor quebra.
- [ ] Sub-goal 3 — A busca exclui `draft` e `deprecated` por padrão, com opt-in granular por estado.
- [ ] Sub-goal 4 — A resolução por id ignora o ciclo de vida, provada por teste de regressão.
- [ ] Sub-goal 5 — Deprecar exige motivo; sucessora é opcional; ambos chegam ao contrato de leitura.
- [ ] Sub-goal 6 — A operação de mudança de estágio existe na API, com autorização e auditoria.

## ADRs

### D1 — Três dimensões ortogonais, nenhuma fundida

**Decisão:** `lifecycle` (estágio) é campo novo, **separado** de `enabled` (habilitação) e do `state`
existente (exclusão).

**Rationale:** herdado do `Blueprint §"D1"`, que provou a ortogonalidade por teste no peer
(`test_include_disabled_still_filters_status:58`). Fundir criaria combinações inventadas e
crescimento multiplicativo de valores.

**Tabela de convivência** (o que a DoD do M32 chamou de "combinações válidas"):

| `state` | `lifecycle` | `enabled` | Significado | Resolve por id? | Aparece na busca? |
|---|---|---|---|---|---|
| `ACTIVE` | `active` | `true` | operação normal | sim | sim |
| `ACTIVE` | `draft` | `true` | publicada mas não anunciada | sim | não (opt-in) |
| `ACTIVE` | `deprecated` | `true` | descontinuada, ainda servindo | **sim** | não (opt-in) |
| `ACTIVE` | qualquer | `false` | desligada temporariamente | sim | não (opt-in) |
| `DELETED` | — | — | apagada; id reservado | não | não |

**Alternativas consideradas:**

1. **Enum único** com todos os valores. Rejeitada: "desligada" é operacional e reversível;
   "descontinuada" é editorial e carrega motivo. Colapsá-las impede desligar algo que não está
   descontinuado.
2. **Reaproveitar o `state` existente** acrescentando `DEPRECATED`. Rejeitada: `state` carrega a
   semântica de exclusão com reserva de id; sobrecarregá-lo faria `DELETED` e `DEPRECATED` parecerem
   o mesmo eixo, quando um é irreversível-com-reserva e o outro é reversível.

**Consequences:** três conceitos convivem e a tabela acima é o contrato. Um teste a percorre inteira.

### D2 — O filtro vive apenas no caminho de busca

**Decisão:** o predicado de ciclo de vida é construído em **um** lugar e aplicado **só** na busca e na
listagem. `getSkillById` e a resolução de instrução não o consultam.

**Rationale:** `Blueprint §"D2"` — no peer, `_build_status_filter` existe apenas no repositório de
busca e o `get` faz `find_one({"_id": path})` sem filtro. É essa separação que faz a deprecação não
quebrar consumidor.

**Alternativas consideradas:**

1. **Filtrar em todo lugar por default, com bypass explícito.** Rejeitada: transforma a exceção em
   regra e um esquecimento vira quebra de consumidor — falha na direção perigosa.
2. **Negar o payload da deprecada.** Rejeitada: é literalmente o efeito que o milestone existe para
   evitar.

**Consequences:** exige o teste de regressão nomeado no Goal — no peer a garantia é só estrutural, e
estrutura sem teste é convenção.

### D3 — Construtor de predicado (Specification), não `if` espalhado

**Decisão:** uma função pura `buildLifecycleFilter(opts)` no domínio devolve a especificação do
filtro; o store a traduz para SQL.

**Rationale:** o peer usa exatamente esse formato (`_build_status_filter(include_draft,
include_deprecated, include_disabled)` — `search_repository.py:379`), e ele é testável sem banco.
Atende a exigência de design pattern do dono com um padrão que **se justifica**: Specification
isola a regra de "o que é visível" da mecânica de consulta.

**Alternativas consideradas:**

1. **State pattern com uma classe por estágio.** Rejeitada com evidência: `Blueprint §"Q1"` mostra que
   os estados **não têm comportamento polimórfico** — são critério de filtro. Quatro classes para
   quatro strings é cerimônia (`rules/parsimony-ladder.md` rung 1).
2. **Condicionais inline no store.** Rejeitada: espalha a regra por cada consulta e torna impossível
   testá-la sem banco.

**Consequences:** o filtro ganha teste unitário puro; o store ganha teste de integração.

### D4 — Validar vocabulário, não transição — e reconciliar com a DoD

**Decisão:** valor fora do vocabulário falha com erro **tipado**. **Não** há matriz de transições
proibidas nesta entrega. O teste que a DoD do M32 pede prova que as dimensões **compõem**
(ortogonalidade, percorrendo a tabela de D1), não que combinações são proibidas.

**Rationale:** `Blueprint §"D4"` — o peer atribui estágio direto (`skill_service.py:1192`) sem
verificar transição, e não sofre com isso. A DoD do M32 foi escrita antes da descoberta e falava em
"combinações válidas"; a evidência mostra que **não há combinação inválida** — há composição. Este
ADR registra a reconciliação em vez de cumprir a letra da DoD contra o que a evidência mostrou.

**Alternativas consideradas:**

1. **Matriz completa de transições.** Rejeitada por YAGNI: zero casos concretos de transição indevida
   — o recurso nem existe. `rules/parsimony-ladder.md` rung 1.
2. **Sem validação alguma.** Rejeitada: string livre é como o `state` de hoje virou `text` sem
   constraint — a dívida que este milestone paga.

**Consequences:** `deprecated → active` fica permitido. Registrado como risco; se surgir caso real, a
máquina de transições é um milestone próprio, não um remendo.

### D5 — CHECK constraint na coluna, divergindo do precedente do repo (v1.1, EC-1)

**Decisão:** a migração da T2.1 cria a coluna **com CHECK constraint**
(`lifecycle IN ('active','draft','deprecated')`), em vez de `text()` livre.

**Rationale:** o v1.0 se contradizia — exigia o teste
`lifecycle_column_rejects_value_outside_vocabulary` e declarava a coluna sem constraint. Tipo
TypeScript não vira restrição no Postgres. Medido: `schema.ts:71` (`state`) e `schema.ts` linha de
`visibility` usam `text()` com default e **zero** CHECK; é exatamente o que o plano chamou de
anti-exemplo. Ou o teste sai, ou a constraint entra — e a constraint é o que torna o plano coerente
com sua própria justificativa. A validação do domínio (T1.1) continua sendo a primeira linha; a
constraint é a rede que pega escrita fora do caminho da aplicação (migração manual, script, psql).

**Alternativas consideradas:**

1. **Seguir o precedente (`text()` livre) e remover o teste.** Rejeitada: perpetua a dívida que este
   milestone diz pagar, e deixa a garantia inteiramente na camada que erra mais (a aplicação).
2. **Enum nativo do Postgres.** Rejeitada: acrescentar valor a um `ENUM` exige `ALTER TYPE`, que em
   versões antigas não roda em transação e complica rollback. CHECK é alterável com `DROP`/`ADD`
   constraint numa migração comum.

**Consequences:** divergimos do padrão local de duas colunas (`state`, `visibility`). Isso é
deliberado e fica registrado; se o time preferir uniformizar, o caminho é acrescentar CHECK **às
outras duas**, não remover desta.

## Dependencies

**Nenhuma dependência nova é adicionada por este plano.**

| Package | Versão | Nova? | Rule 9 (não reinventar) — por que não adicionamos |
|---|---|---|---|
| `drizzle-orm` | já declarada | Não | Já é o ORM do projeto; a coluna e a migração usam o que existe |
| `zod` | já declarada | Não | Já valida o contrato; o schema de `reason`/`supersededBy` entra nele |
| `vitest` | já declarada | Não | Runner atual; nenhum teste deste plano exige capacidade nova |
| — máquina de estados (ex.: `xstate`) | — | **Rejeitada** | ADR D4: não há transições proibidas a modelar. Uma lib de FSM para validar um union de 3 valores é o rung 1 da `parsimony-ladder` reprovando por excesso |
| — lib de enum/validação extra | — | **Rejeitada** | `rules/parsimony-ladder.md` rung 4: o Zod já instalado cobre; o `parseLifecycle` do domínio são ~10 linhas de stdlib TS |

O único artefato novo com superfície externa é a **CHECK constraint** (D5), que é SQL nativo do
Postgres — nenhum pacote envolvido.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Mudar o default de `:retrieve` (excluir `deprecated`/`draft`) é **mudança de comportamento** para consumidor já integrado | **Alta** | O opt-in é entregue e documentado **antes** de o default virar; o CHANGELOG anuncia; nenhum consumidor perde acesso — só precisa pedir | implementador |
| `deprecated → active` permitido (D4) ressuscita descontinuada sem cerimônia | Média | Registrado; a operação exige autorização e fica auditada, então é rastreável mesmo sem ser proibida | implementador |
| Três dimensões convivendo aumentam a carga cognitiva de quem lê o store | Média | A tabela de D1 vira teste executável percorrendo as cinco linhas — a documentação não pode divergir do código | implementador |
| O blueprint generalizou de **uma** amostra (o `mcp-context-forge` não foi aberto) | Média | Limite declarado no blueprint; se o desenho de duas dimensões travar na implementação, é a primeira pedra a virar | autor do plano |
| A coluna "listagem" da Q3 ficou sem medição independente | Média | Decidido por nós, não herdado: a listagem aplica o mesmo filtro da busca, e a T4.1 cobre `GET /v1/skills` com teste próprio | implementador |
| `handlers/skills.ts` já tem 497 LoC (teto 500) | Baixa | O handler novo nasce em `handlers/lifecycle.ts`, não estende o existente | implementador |

## Unresolved Questions

- Q1 — O `reason` da deprecação deve ter limite de tamanho? Proposta: 500 chars, alinhado ao
  `compatibility` da spec canônica — mas é decisão de produto.
- Q2 — Uma skill `draft` deve ser instalável por `theoskill install`? O plano assume **sim** (a
  resolução ignora o estágio), mas isso significa que o autor pode distribuir um rascunho por link
  direto. Se for indesejado, é regra do CLI, não do registry.
- Q3 — A deprecação deve propagar para os canais que apontam para a skill (ex.: `stable` deixa de
  resolver)? O plano assume **não** — canal e ciclo de vida são eixos distintos — mas a interação não
  foi investigada.

## Dependency Graph

```
Fase 1 (domínio: vocabulário + filtro puro)
   │
   ├──▶ Fase 2 (schema + migração aditiva)
   │        │
   │        └──▶ Fase 3 (store: filtro na busca, nunca na resolução)
   │                 │
   │                 ├──▶ Fase 4 (API: opt-in no :retrieve + listagem)
   │                 └──▶ Fase 5 (operação de deprecar + motivo/sucessora no contrato)
   │                              │
   └──────────────────────────────┴──▶ Fase 6 (Integration Validation)
```

Fase 1 é bloqueante de tudo. Fases 4 e 5 podem paralelizar após a 3.

---

## Phase 1: Domínio — vocabulário fechado e predicado puro

**Objective:** ter o ciclo de vida como conceito de domínio, testável sem banco e sem HTTP.

### T1.1 — Vocabulário de estágio com erro tipado

#### Objective
Criar o tipo fechado do estágio e a função que valida uma string contra ele, falhando com erro tipado.

#### Why this step (action + reasoning)

**O que faz:** cria `packages/core/src/domain/skill-lifecycle.ts` com o union `SkillLifecycle`
(`'active' | 'draft' | 'deprecated'`), o parser `parseLifecycle(input: string)` e o erro
`InvalidLifecycleError`.

**Por que agora:** é a base de todas as fases e não depende de nada. Fazê-la primeiro permite que o
schema (Fase 2) derive a coluna do tipo do domínio, em vez de duplicar a lista de valores — o erro
que produziu o `state: text()` sem constraint que estamos corrigindo. Decisões D1 e D4.

#### Evidence
- `Blueprint §"Q1"` — o peer usa `class LifecycleStatus(str, Enum)` em `registry_card.py:27` e valida com função dedicada em `:36-47`.
- `Blueprint §"D4"` — validação é de valor, não de transição.
- `packages/core/src/infrastructure/db/schema.ts:71` — o `state` atual é `text()` sem constraint; é o anti-exemplo.
- `rules/error-handling.md` § 2 — erro explícito e tipado, nunca string genérica.

#### Files to edit
```
packages/core/src/domain/skill-lifecycle.ts (NEW) — union, parser, erro tipado
packages/core/src/domain/skill-lifecycle.test.ts (NEW) — RED primeiro
```

#### Deep file dependency analysis
- Arquivo novo, sem dependentes ainda. Não importa Drizzle nem nada de `infrastructure/` — a direção
  permitida por `rules/architecture.md` é infra→domínio, nunca o contrário.
- Downstream: `schema.ts` (Fase 2) deriva a coluna; `skills-store.ts` (Fase 3) consome o parser.

#### Deep Dives
- **Por que `deprecated` e não `deprecated` + `beta`:** `Blueprint §"D1"` alternativa 3 — `beta`
  duplicaria o conceito de canal, entregue no M19. Maturidade é da **revisão**, não da skill.
- **Invariante:** o parser normaliza para minúsculas antes de validar (o peer faz o mesmo —
  `test_status_normalized_to_lowercase:101`), porque a entrada vem de HTTP e de CLI.
- **Edge case:** string vazia → erro (não é o mesmo que ausente).
- **Negative case:** `'DELETED'` → erro. É valor do **outro** eixo; aceitar seria fundir dimensões que
  D1 mantém separadas.

#### Pseudo-code / Signatures

```pseudocode
type SkillLifecycle = 'active' | 'draft' | 'deprecated'
class InvalidLifecycleError extends Error { readonly code = 'INVALID_LIFECYCLE'; readonly value: string }

function parseLifecycle(input: string): SkillLifecycle
  normalized = input.trim().toLowerCase()
  if normalized not in VALUES: throw new InvalidLifecycleError(input)
  return normalized

# Example
input:  "DEPRECATED"  -> output: "deprecated"
input:  "DELETED"     -> throw InvalidLifecycleError { code: 'INVALID_LIFECYCLE', value: 'DELETED' }
```

#### Tasks
1. Escrever os testes RED (aceita os 3, normaliza caixa, rejeita vazio, rejeita `DELETED`, erro é tipado).
2. Implementar o union, o erro e o parser.

#### TDD
```
RED:     parse_accepts_the_three_stages() — 'active'|'draft'|'deprecated' retornam a si mesmos
RED:     parse_normalizes_case() — 'DEPRECATED' → 'deprecated'
RED:     parse_rejects_empty_string_with_typed_error() — erro é InvalidLifecycleError, code INVALID_LIFECYCLE
RED:     parse_rejects_deleted_because_it_is_another_axis() — 'DELETED' reprova (D1)
GREEN:   Implementar
REFACTOR: Nenhum esperado (módulo puro)
VERIFY:  pnpm --filter @usetheo/skills-core test -- skill-lifecycle
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Sem import de `infrastructure/` nem de HTTP no arquivo
- [ ] Erro tipado com `code` estável, não `Error` genérico
- [ ] Pass: coverage — 100% neste arquivo (é vocabulário; qualquer ramo não coberto é valor aceito por engano)
- [ ] Pass: lint — `pnpm lint` limpo; Pass: typecheck — `pnpm typecheck` limpo

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG `[Unreleased]` atualizado

---

### T1.2 — Predicado de visibilidade como função pura (Specification)

#### Objective
Criar `buildLifecycleFilter(opts)`, que devolve a especificação de quais estágios/habilitação são
visíveis, sem tocar em SQL.

#### Why this step (action + reasoning)

**O que faz:** implementa o construtor de predicado no domínio, com as flags `includeDraft`,
`includeDeprecated`, `includeDisabled`, devolvendo uma estrutura que o store traduz.

**Por que agora:** é a regra central do milestone e a que mais precisa de teste barato. Separá-la do
store permite percorrer a tabela de D1 sem subir banco. Decisão D3.

#### Evidence
- `Blueprint §"D3"` e `§"Q3"` — o peer constrói o filtro numa função dedicada (`search_repository.py:379`) com exatamente essas três flags.
- `Blueprint §"Q3"` tabela — default exclui os três; cada um tem opt-in próprio (`test_lifecycle_status.py:39,49,58`).
- `Blueprint §"Q1"` — não usar State pattern: os estados não têm comportamento.

#### Files to edit
```
packages/core/src/domain/skill-lifecycle.ts — acrescenta buildLifecycleFilter
packages/core/src/domain/skill-lifecycle.test.ts — RED primeiro
```

#### Deep file dependency analysis
- Mesmo módulo da T1.1 (coesão: é a mesma responsabilidade — "o que o ciclo de vida significa").
  Se o arquivo passar de ~200 LoC, extrair o filtro para `skill-lifecycle-filter.ts`.
- Downstream: `skills-store.ts` (Fase 3) traduz para `WHERE`.

#### Deep Dives
- **Composição, não anulação:** pedir `includeDisabled` **não** pode desligar o filtro de estágio — é
  a ortogonalidade que D1 exige e que o peer prova em `test_include_disabled_still_filters_status:58`.
- **Edge case:** todas as flags `true` → predicado vazio (sem restrição), como
  `test_include_all_returns_empty_dict:30`.
- **Edge case:** nenhuma flag → exclui `draft`, `deprecated` e desabilitadas.
- **Invariante de retrocompatibilidade:** linha cuja coluna ainda é `NULL` (janela entre migração e
  backfill) **passa** — a Fase 2 elimina a janela com default, mas o predicado não pode assumir isso.

#### Pseudo-code / Signatures

```pseudocode
interface LifecycleVisibility { stages: SkillLifecycle[]; requireEnabled: boolean }

function buildLifecycleFilter(opts?: {includeDraft?, includeDeprecated?, includeDisabled?}): LifecycleVisibility
  stages = ['active']
  if opts.includeDraft:      stages.push('draft')
  if opts.includeDeprecated: stages.push('deprecated')
  return { stages, requireEnabled: !opts.includeDisabled }

# Example
input:  {}                       -> { stages: ['active'],                        requireEnabled: true  }
input:  {includeDisabled: true}  -> { stages: ['active'],                        requireEnabled: false }  // estágio SEGUE filtrado
input:  {includeDraft: true, includeDeprecated: true, includeDisabled: true}
                                 -> { stages: ['active','draft','deprecated'],   requireEnabled: false }
```

#### Tasks
1. Testes RED cobrindo os cinco casos (default, cada opt-in isolado, todos).
2. Implementar a função pura.

#### TDD
```
RED:     default_excludes_draft_deprecated_and_disabled()
RED:     include_disabled_still_filters_stages() — a ortogonalidade (D1)
RED:     include_draft_only_still_excludes_deprecated()
RED:     include_all_yields_no_restriction()
GREEN:   Implementar
REFACTOR: Extrair para arquivo próprio se skill-lifecycle.ts > 200 LoC
VERIFY:  pnpm --filter @usetheo/skills-core test -- skill-lifecycle
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Função pura, sem import de Drizzle nem de `pg`
- [ ] A ortogonalidade é asseverada explicitamente (não inferida de outro teste)
- [ ] Pass: coverage 100% neste arquivo
- [ ] Pass: lint + typecheck limpos

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Phase 2: Schema e migração aditiva

**Objective:** as colunas existirem sem que nenhuma linha ou consumidor existente quebre.

### T2.1 — Colunas `lifecycle` e `enabled`, aditivas, com backfill implícito

#### Objective
Adicionar as duas colunas ao `skills` com default que torna toda linha pré-existente `active` e
habilitada.

#### Why this step (action + reasoning)

**O que faz:** estende `schema.ts` com `lifecycle` (default `'active'`) e `enabled` (default `true`),
e gera a migração `0014_*`.

**Por que agora:** sem coluna não há o que filtrar. E o default é a decisão de produto que o blueprint
identificou como portável: *linha pré-existente vira `active`, registro novo vira `draft`* — com a
diferença de que a **segunda metade é da API** (Fase 5), não do banco.

#### Evidence
- `Blueprint §"Q6"` — no peer, `test_documents_without_status_field_pass_through:67` e os defaults por origem em `:121-165`. A semântica é portável; o mecanismo (`$exists:false`) não.
- `packages/core/src/infrastructure/db/schema.ts:71` — precedente de coluna de estado com default.
- Última migração: `packages/core/src/infrastructure/db/migrations/0013_wild_invisible_woman.sql`.

#### Files to edit
```
packages/core/src/infrastructure/db/schema.ts — colunas lifecycle + enabled
packages/core/src/infrastructure/db/migrations/0014_*.sql (NEW) — gerada por pnpm db:generate
```

#### Deep file dependency analysis
- `schema.ts` (Baseline: 441 LoC, `f95749d`) — a invariante do Baseline manda preservar a semântica de
  `state`/`deletedAt`/`reservedUntil`. As colunas novas são **adicionais**, não substituem nada.
- Downstream: `skills-store.ts` projeta as colunas novas (Fase 3).

#### Deep Dives
- **Default `active`, não `draft`, no banco.** A linha que já existe estava em produção; marcá-la
  `draft` a esconderia da busca no momento da migração — quebra silenciosa exatamente na entrega que
  promete não quebrar. O `draft` como default de **registro novo** é regra da API (Fase 5).
- **Tipo:** deriva do union do domínio, não uma segunda lista de strings — evitar a duplicação que
  produziu o `text()` sem constraint atual.
- **Índice:** o peer indexa `[visibility, is_enabled, registry_name]` (`skill_repository.py:182`).
  Nosso equivalente entra **se** a Fase 6 medir degradação; incluir índice sem medida é otimização
  prematura.
- **Edge case:** migração rodando com escrita concorrente — `ADD COLUMN ... DEFAULT` é operação de
  metadados no Postgres ≥ 11 (não reescreve a tabela), portanto não bloqueia por tempo relevante.

#### Tasks
1. Teste RED que asserta o default (linha inserida sem o campo sai `active`/`true`).
2. Teste RED do NULL: `row_with_null_lifecycle_is_treated_as_active` — inserir NULL por SQL direto,
   contornando o default, e asseverar que a skill **aparece** na busca (v1.1, EC-4: falha na direção
   perigosa seria esconder sem ninguém pedir).
3. Estender `schema.ts` derivando o tipo do domínio.
4. `pnpm db:generate`, **acrescentar o CHECK constraint ao SQL gerado** (D5) e revisar **antes** de
   aplicar.
5. `pnpm db:migrate` no banco local.

#### TDD
```
RED:     existing_row_defaults_to_active_and_enabled() — insert sem os campos → 'active', true
RED:     lifecycle_column_rejects_value_outside_vocabulary() — a garantia que o `state` de hoje não tem
GREEN:   Estender schema + gerar migração
REFACTOR: Nenhum esperado
VERIFY:  pnpm db:generate && pnpm db:migrate && pnpm --filter @usetheo/skills-api test:integration -- lifecycle
```

#### Concurrency tests
```
(none — single-threaded)
```
A migração é DDL única; não há estado compartilhado em processo. O comportamento sob escrita
concorrente está coberto em Deep Dives (operação de metadados).

#### Acceptance Criteria
- [ ] Migração aditiva: nenhuma coluna removida ou renomeada
- [ ] Toda linha pré-existente sai `active` + habilitada
- [ ] O SQL gerado foi **revisado** antes de aplicar (não aplicado às cegas)
- [ ] Pass: lint + typecheck; `schema.ts` ≤ 500 linhas

#### DoD
- [ ] `pnpm test` e `pnpm test:integration` verdes
- [ ] CHANGELOG atualizado

---

## Phase 3: Store — filtro na busca, nunca na resolução

**Objective:** materializar a garantia central do milestone, com o teste que o peer não tem.

### T3.1 — O predicado entra na busca

#### Objective
Traduzir `LifecycleVisibility` para `WHERE` nas consultas de busca e listagem.

#### Why this step (action + reasoning)

**O que faz:** o store passa a receber a especificação da Fase 1 e a aplicar nas consultas de
descoberta.

**Por que agora:** é o que faz a deprecação surtir efeito. Vem depois do schema porque precisa das
colunas.

#### Evidence
- `Blueprint §"D2"` e `§"Q7"` — no peer o filtro só existe no repositório de busca (`search_repository.py:1344,1733,2097,2355`).
- `packages/api/src/server/store/skills-store.ts:147` — projeção atual do `SELECT`, onde as colunas novas entram.

#### Files to edit
```
packages/api/src/server/store/skills-store.ts — aplica o predicado nas consultas de busca/listagem
packages/api/src/server/store/skills-store.test.ts — RED primeiro
```

#### Deep file dependency analysis
- `skills-store.ts` (Baseline: 419 LoC, `294850f`) — a invariante do Baseline é explícita: **a leitura
  por id não ganha filtro**. Esta task toca apenas os caminhos de busca/listagem.
- Downstream: handlers de `:retrieve` e `GET /v1/skills` (Fase 4).

#### Deep Dives
- **Ponto único de tradução.** Um só helper converte `LifecycleVisibility` em condição SQL; nenhuma
  consulta monta a condição à mão (D3).
- **Edge case:** linha com `lifecycle` NULL (não deve existir após a Fase 2, mas o predicado tolera) →
  tratada como `active`.
- **Negative case:** chamar a busca com flag desconhecida → erro tipado na fronteira (handler), não no
  store.

#### Tasks
1. Testes RED de integração percorrendo a tabela de D1.
2. Implementar o helper de tradução e aplicá-lo às consultas de descoberta.

#### TDD
```
RED:     search_excludes_deprecated_by_default()
RED:     search_includes_deprecated_when_opted_in()
RED:     search_with_include_disabled_still_excludes_draft() — ortogonalidade no SQL, não só no domínio
GREEN:   Implementar
REFACTOR: Extrair o helper se a duplicação aparecer em >2 consultas
VERIFY:  pnpm --filter @usetheo/skills-api test:integration -- skills-store
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhuma consulta monta condição de ciclo de vida à mão
- [ ] A tabela de D1 é percorrida por teste
- [ ] Pass: lint + typecheck; `skills-store.ts` ≤ 500 linhas

#### DoD
- [ ] `pnpm test:integration` verde
- [ ] CHANGELOG atualizado

---

### T3.2 — O teste de regressão que prova a garantia

#### Objective
Provar que a deprecada continua resolvível por id — e falhar se alguém adicionar o filtro ao caminho
de leitura.

#### Why this step (action + reasoning)

**O que faz:** escreve `deprecated_skill_still_resolves_by_id`, que deprecia uma skill e então a
resolve por id e por instrução, asseverando sucesso.

**Por que agora:** é a métrica do Goal. Sem ele, a garantia é convenção — e o blueprint registra que,
no peer, ela é **apenas** estrutural: nada impede alguém de adicionar o filtro ao `get` amanhã.

#### Evidence
- `Blueprint §"Q7"` — *"Não existe um teste chamado 'deprecada continua resolvível'. A garantia vem da separação de caminhos… mais frágil (nada impede alguém de adicionar o filtro ao `get` amanhã)"*.
- `packages/api/src/server/store/skills-store.ts` — a invariante do Baseline que este teste protege.

#### Files to edit
```
packages/api/src/server/store/skills-store.test.ts — o teste de regressão
packages/api/tests/integration/m32-lifecycle.integration.test.ts (NEW) — jornada completa
```

#### Deep Dives
- **O teste precisa falhar pelo motivo certo.** Antes de implementar, verificar que ele **passa**
  trivialmente (a resolução ainda não tem filtro) — um teste que nasce verde não protege nada. Para
  torná-lo significativo, o par é: adicionar temporariamente o filtro ao `get`, confirmar que o teste
  **reprova**, e remover. Sem essa verificação, é teste decorativo.
- **Edge case:** skill deprecada **e** desabilitada → continua resolvível (D1, linha 4 da tabela).
- **Negative case:** skill `DELETED` → **não** resolve. É o outro eixo, e o teste deve provar a
  diferença.

#### Tasks
1. Escrever o teste de regressão.
2. Provar que ele discrimina — **em `git stash` ou worktree separado** (v1.1, EC-3): adicionar o
   filtro ao `get`, confirmar que o teste **reprova**, e restaurar. Commitar essa edição por engano
   entregaria o oposto do milestone.
3. Confirmar `git diff --exit-code packages/api/src/server/store/skills-store.ts` limpo após a prova.
4. Escrever a jornada de integração: publicar → deprecar → sumir da busca → resolver por id.

#### TDD
```
RED:     deprecated_skill_still_resolves_by_id() — resolve com sucesso após deprecação
RED:     deprecated_and_disabled_still_resolves_by_id() — as duas dimensões juntas
RED:     deleted_skill_does_not_resolve() — o eixo de exclusão continua negando
RED:     deprecated_skill_absent_from_retrieve_by_default() — a outra metade do Goal
GREEN:   (já implementado nas tasks anteriores; aqui o teste é o entregável)
REFACTOR: Nenhum esperado
VERIFY:  pnpm --filter @usetheo/skills-api test:integration -- m32-lifecycle
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] O teste foi **provado discriminante** (reprova quando o filtro é adicionado ao `get`)
- [ ] `git diff --exit-code` limpo em `skills-store.ts` após a prova (v1.1, EC-3)
- [ ] Os dois testes nomeados no Goal existem e passam
- [ ] Pass: lint + typecheck

#### DoD
- [ ] `pnpm test:integration` verde
- [ ] CHANGELOG atualizado

---

## Phase 4: API — opt-in granular na descoberta

**Objective:** o consumidor poder pedir o que está escondido, explicitamente.

### T4.1 — `:retrieve` e `GET /v1/skills` aceitam as três flags

#### Objective
Expor `include_draft`, `include_deprecated`, `include_disabled`, com default que exclui os três.

#### Why this step (action + reasoning)

**O que faz:** os handlers passam a ler as flags, validá-las na fronteira e repassá-las ao store.

**Por que agora:** o opt-in precisa existir **antes** de o default mudar — é a mitigação do risco de
maior severidade deste plano.

#### Evidence
- `Blueprint §"Q3"` — o peer tem as três flags separadas (`test_lifecycle_status.py:39,49,58`) e o opt-in total devolve filtro vazio (`:30`).
- `packages/api/src/server/handlers/retrieve.ts:95-96` — o handler já projeta contadores; as flags entram no mesmo ponto.

#### Files to edit
```
packages/api/src/server/handlers/lifecycle-flags.ts (NEW) — parse+validação das 3 flags (v1.1, EC-2)
packages/api/src/server/handlers/lifecycle-flags.test.ts (NEW) — RED primeiro
packages/api/src/server/handlers/retrieve.ts — importa o parse
packages/api/src/server/handlers/skills.ts — importa o parse (hoje 497 LoC; a extração evita o estouro)
packages/api/src/server/handlers/retrieve.test.ts — RED primeiro
```

> **v1.1 (EC-2):** a extração é **desde o início**, não condicional. `handlers/skills.ts` está a 3
> linhas do teto de 500; descobrir isso no fim da fase forçaria refactor não planejado — retrabalho.

#### Deep Dives
- **Validação na fronteira** (`rules/architecture.md`): flag desconhecida ou valor não-booleano →
  erro tipado 4xx com o campo nomeado, não 500.
- **Invariante:** os contadores `matched_vector`/`matched_keyword` continuam emitindo (Baseline).
- **Edge case:** as três flags `true` → resultado idêntico ao de antes deste milestone. É a prova de
  que nada foi perdido.

#### Tasks
1. Testes RED das flags e do default.
2. Parse + validação na fronteira nos dois handlers.

#### TDD
```
RED:     retrieve_excludes_deprecated_by_default()
RED:     retrieve_with_include_deprecated_returns_it()
RED:     retrieve_with_all_flags_matches_pre_milestone_behavior()
RED:     retrieve_rejects_non_boolean_flag_with_typed_error()
GREEN:   Implementar
REFACTOR: Extrair o parse das flags se duplicar entre os dois handlers
VERIFY:  pnpm --filter @usetheo/skills-api test -- retrieve
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Default exclui os três; cada flag tem efeito isolado
- [ ] Flag inválida → erro tipado nomeando o campo
- [ ] `handlers/skills.ts` ≤ 500 linhas (hoje 497 — se estourar, extrair)
- [ ] Pass: lint + typecheck

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Phase 5: Deprecar como operação, com motivo e sucessora

**Objective:** a ação existir na API, exigir motivo, e o contrato de leitura carregá-lo.

### T5.1 — `PUT /v1/skills/:id/lifecycle` com motivo obrigatório

#### Objective
Criar a operação que muda o estágio, exigindo `reason` quando o destino é `deprecated`.

#### Why this step (action + reasoning)

**O que faz:** novo handler em arquivo próprio, com autorização (escopo de escrita) e auditoria.

**Por que agora:** fecha a capacidade. Vem por último porque depende de tudo anterior.

#### Evidence
- `Blueprint §"D3"` — o peer **não tem** motivo nem sucessora; é lacuna que preenchemos.
- `packages/api/src/server/handlers/skills.ts` (497 LoC) — perto do teto; o handler novo vai para arquivo próprio (Baseline § invariantes).

#### Files to edit
```
packages/api/src/server/handlers/lifecycle.ts (NEW) — o handler
packages/api/src/server/handlers/lifecycle.test.ts (NEW) — RED primeiro
packages/core/src/contract/index.ts — schema Zod de reason/supersededBy
packages/core/src/infrastructure/db/schema.ts — colunas deprecation_reason, superseded_by
```

#### Deep Dives
- **`reason` obrigatório só para `deprecated`.** Ir para `active` ou `draft` não exige motivo — não há
  o que explicar a um consumidor que não perde nada.
- **`supersededBy` opcional** (D3, alternativa 3): nem toda deprecação tem substituta; obrigar
  inventaria ponteiro falso.
- **Edge case:** `supersededBy` apontando para skill inexistente ou para si mesma → erro tipado.
- **Negative case:** sem escopo de escrita → 403 com o texto do serviço nomeando o escopo.
- **Q1 (aberta):** limite de tamanho do `reason` — proposta 500 chars; decidir antes de implementar.

#### Tasks
1. Responder Q1 (limite do `reason`).
2. Testes RED (motivo obrigatório, sucessora inválida, autorização, auditoria).
3. Colunas + contrato Zod.
4. Handler em arquivo próprio.

#### TDD
```
RED:     deprecating_without_reason_is_rejected_with_typed_error()
RED:     superseded_by_self_is_rejected()
RED:     superseded_by_unknown_skill_is_rejected()
RED:     reason_and_successor_reach_the_read_contract() — GET devolve os dois
RED:     without_write_scope_returns_403_with_service_text()
GREEN:   Implementar
REFACTOR: Nenhum esperado
VERIFY:  pnpm --filter @usetheo/skills-api test -- lifecycle
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `reason` obrigatório para `deprecated`, opcional para os demais
- [ ] `supersededBy` validado (existe, não é self)
- [ ] Os dois campos chegam ao contrato de leitura (aditivos)
- [ ] Operação auditada
- [ ] Pass: lint + typecheck; arquivos ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Coverage Matrix

| # | Gap / Requirement (DoD do M32) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Dimensões ortogonais, não enum único; combinações declaradas e testadas | T1.1, T1.2, T2.1, T3.1 | ADR D1 com tabela; ortogonalidade asseverada em domínio (T1.2) e em SQL (T3.1) |
| 2 | Deprecada continua resolvível; teste de regressão | T3.2 | Teste nomeado no Goal + prova de que discrimina |
| 3 | `:retrieve` exclui por padrão, com opt-in | T4.1 | Três flags independentes; opt-in entregue antes de o default mudar |
| 4 | Motivo e sucessora no contrato até SDK/MCP/CLI | T5.1 | Campos aditivos no contrato de leitura |
| 5 | Migração aditiva; nenhum consumidor quebra | T2.1 | Colunas com default; linha pré-existente vira `active` |
| 6 | O contrato de leitura carrega estágio, motivo e sucessora para que a tela possa dizer o que deixa de valer | T5.1 | Campos aditivos no `GET`; a tela que os consome é do M33, mas **o que este repositório deve entregar para viabilizá-la** está coberto aqui |

**Coverage: 6/6 requisitos cobertos (100%)**

> **Nota de fronteira.** O bullet da DoD do M32 diz "a tela diz o que deixa de valer". A tela nasce em
> `theo-cloud/dashboard` — o `CLAUDE.md` deste repositório proíbe frontend aqui. O que este plano
> cobre é a **condição necessária**: sem estágio, motivo e sucessora no contrato de leitura, a tela
> não teria o que dizer. A renderização é entregue pelo M33, que declara o M31 como dependência.
> Isso não é uma lacuna escondida: é a mesma divisão de repositórios que o M31 já enfrentou, e o
> `/acceptance M32` valida o eixo que existe aqui.

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] `pnpm test` · `pnpm test:integration` verdes
- [ ] `pnpm typecheck` sem erros · `pnpm lint` sem avisos
- [ ] Orçamento de 500 LoC respeitado (atenção: `handlers/skills.ts` está em 497)
- [ ] `CHANGELOG.md` atualizado sob `[Unreleased]` (Unbreakable Rule 6)
- [ ] **Compatibilidade preservada:** com as três flags `true`, o comportamento é idêntico ao de antes do milestone (T4.1)
- [ ] Q1, Q2 e Q3 respondidas ou explicitamente adiadas com registro
- [ ] **Prova de comportamento:** o teste de regressão foi provado **discriminante**, não apenas verde

## Failure scenarios

O store fala com o Postgres; os handlers falam com o store.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:skills` (DB) | migração aplicada pela metade | rodar a suíte contra banco sem a coluna | Erro claro na inicialização, não `undefined` silencioso virando `active` |
| `postgres:skills` (DB) | conexão cai durante `PUT .../lifecycle` | derrubar a conexão no meio da transação | Nenhuma escrita parcial; o estágio anterior permanece |
| `postgres:skills` (DB) | linha com `lifecycle` NULL (janela de migração) | inserir linha com NULL diretamente | Tratada como `active`, nunca escondida por acidente |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** provar a jornada inteira contra banco real, não só em unidades.

### Execution

```
pnpm typecheck
pnpm lint
pnpm test
pnpm compose:up && pnpm db:migrate && pnpm test:integration
```

### Acceptance Criteria

- [ ] Todas as suítes verdes
- [ ] Cobertura ≥ 90% nos arquivos alterados; **100%** em `skill-lifecycle.ts` (vocabulário e predicado governam o que a busca esconde)
- [ ] Zero erros de tipo e zero avisos de lint
- [ ] Toda linha de `## Failure scenarios` exercitada
- [ ] A jornada `publicar → deprecar → sumir da busca → resolver por id` passa contra Postgres real

### If Validation Fails

1. Separar falhas deste plano das pré-existentes
2. Corrigir todas as causadas por este plano
3. Re-rodar a cadeia
4. Pré-existentes vão para a descrição do PR e não bloqueiam
