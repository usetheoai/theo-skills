# Blueprint: ciclo de vida de skill — retirar de circulação sem quebrar quem já usa

> **Version 1.0** — Investiga como um registry real modela ciclo de vida de entidade. **A resposta
> central é estrutural e resolve o M32 inteiro:** o peer separa `status` (estágio) de `is_enabled`
> (habilitação) como dimensões ortogonais, aplica o filtro **só no caminho de busca**, e deixa a
> **leitura por id sem filtro algum** — de modo que a deprecada some da descoberta e continua
> resolvível por quem a referencia. Isso não é interpretação: `_build_status_filter` é usado em
> quatro pontos, **todos** em `search_repository.py`, e o `get()` do repositório de skill faz
> `find_one({"_id": path})` sem tocar em estado.
>
> Dois achados negam prior art e viram trabalho nosso: o peer **não valida transições** (qualquer
> estado vira qualquer estado) e **não tem motivo nem sucessora** de deprecação.

**Slug:** `m32-skill-lifecycle`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m32-skill-lifecycle-plan.md` (v1.1)
**Owner:** usetheodev
**Generated:** 2026-08-03 via `/discover-execute` (em linha; sessão interativa)
**Confidence verdict:** _(a preencher por `/discover-confidence`)_
**Perguntas:** 8 — 8 `done`, 0 `blocked`

## Context

O domínio do `theo-skills` só sabe `ACTIVE` e `DELETED`
(`packages/core/src/infrastructure/db/schema.ts:71`; `packages/api/src/server/store/skills-store.ts:397`
faz soft-delete gravando `deletedAt` + `reservedUntil`). Não existe forma de dizer "não use mais
esta" sem apagá-la — e apagar reserva o identificador, quebrando quem a referencia. O formato
canônico não ajuda: `agentskills-spec` define seis campos e nenhum é de ciclo de vida.

## Objective

Decidir como modelar o ciclo de vida — quantas dimensões, quais transições, onde validar, e qual o
efeito de cada estado na descoberta versus na resolução.

---

## Coverage Corner 1 — Integration Tests

### Q7 — a deprecada continua resolvível? **Sim, e a garantia é estrutural, não um teste.**

O ponto decisivo é **onde** o filtro de estado é aplicado.

`_build_status_filter` é definido em
`.claude/knowledge-base/references/mcp-gateway-registry/registry/repositories/documentdb/search_repository.py:379`
e usado em exatamente quatro lugares — **todos no mesmo arquivo**: linhas 1344, 1733, 2097 e 2355.
Um `grep -rn "_build_status_filter" registry/` sobre todo o backend não devolve nenhum uso fora do
repositório de **busca**.

E a leitura por identificador ignora o estado por completo:
`.../registry/repositories/documentdb/skill_repository.py:190-197` — `async def get(...)` executa
`collection.find_one({"_id": path})`, sem cláusula de `status` nem de `is_enabled`.

| Caminho | Aplica filtro de ciclo de vida? | Evidência |
|---|---|---|
| Busca / descoberta | **Sim** | `search_repository.py:1344,1733,2097,2355` |
| Leitura por id (resolução) | **Não** | `skill_repository.py:190-197` (`find_one({"_id": path})`) |

**Consequência, e é exatamente o que o M32 precisa:** deprecar remove da descoberta sem remover da
resolução. Quem já referencia a skill continua carregando a instrução; quem procura por intenção não
a encontra mais.

**Honestidade sobre o que isto é.** Não existe um teste chamado *"deprecada continua resolvível"*.
A garantia vem da **separação de caminhos** — o filtro simplesmente não existe no caminho de leitura.
Isso é mais forte que um teste (é estrutural) e mais frágil (nada impede alguém de adicionar o filtro
ao `get` amanhã). **Para nós, isso vira requisito de teste**, não de estrutura: a DoD do M32 exige o
teste de regressão que o peer não tem.

### Q8 — há teste que reprova estado inválido? **Sim, para valor. Não para combinação.**

`.claude/knowledge-base/references/mcp-gateway-registry/tests/unit/test_lifecycle_status.py:106-109`:

- `test_invalid_status_rejected` usa `pytest.raises(ValueError, match="Invalid status")` — erro
  **tipado** com mensagem específica, o que `rules/testing.md` § 4.1 exige de um caso negativo.
- Complementos: `test_valid_status_accepted:96`, `test_status_normalized_to_lowercase:101` (entrada
  `"ACTIVE"` → `"active"`), `test_all_enum_values_accepted:111` (os quatro valores).

**O que NÃO existe: nenhum teste de combinação inválida entre `is_enabled` e `status`.** O peer
valida cada campo isoladamente. Não há caso que pergunte se "desabilitada + `active`" faz sentido —
porque, no desenho dele, faz: são dimensões independentes por construção.

**Consequência para nós:** a DoD do M32 pede "tabela de combinações válidas testada". Isso vai
**além** do peer. Antes de escrevê-la, o plano de implementação precisa responder se a combinação
livre é defeito ou desenho — a evidência aqui sugere **desenho**, e uma tabela de restrições poderia
ser cerimônia contra um problema que não existe (`rules/parsimony-ladder.md` rung 1).

---

## Coverage Corner 2 — Dependencies

### Q4 — o formato canônico define ciclo de vida? **Não. Nenhum dos seis campos.**

`.claude/knowledge-base/references/agentskills-spec/docs/specification.mdx:25-32` define `name`,
`description`, `license`, `compatibility`, `metadata` e `allowed-tools`. Nenhum é de estado.

| Campo | Na spec? | O peer adiciona? | Nós temos? |
|---|---|---|---|
| `status` (estágio) | Não | **Sim** — `str` validado contra enum | Não |
| `is_enabled` (habilitação) | Não | **Sim** — `bool`, default `True` | Não |
| `health_status` | Não | Sim — `Literal["healthy","unhealthy","unknown"]` | Não |
| `state` (`ACTIVE`/`DELETED`) | Não | — | **Sim** (nosso, hoje) |

**Ciclo de vida é decisão do registro, não do formato.** Nós e o peer chegamos ao mesmo lugar por
caminhos independentes — e o nosso está atrasado em uma dimensão.

### Q5 — motivo e sucessora viajam no contrato? **Não existem no peer.**

`grep -nE "reason|replac|successor|superseded|sunset|deprecat"` sobre
`.claude/knowledge-base/references/mcp-gateway-registry/registry/schemas/skill_models.py` devolve
**uma única linha** — a 406, e é apenas a *descrição* do campo `status`
(`"Lifecycle status (default: draft). Allowed: active, deprecated, draft, beta"`).

Não há campo de motivo. Não há ponteiro para sucessora. Deprecar, no peer, é trocar uma string.

**Consequência honesta: aqui não há prior art e a DoD do M32 vai além do peer.** Um agente que
recebe "esta skill está deprecada" sem saber *por quê* nem *o que usar no lugar* fica com a mesma
informação que teria com um 404 — sabe que parou, não sabe o que fazer. O campo é nosso a desenhar,
e o blueprint não pode fingir que copiou.

---

## Coverage Corner 3 — Tools

### Q6 — migração aditiva sem quebrar consumidor: **o filtro tolera a ausência do campo.**

`.claude/knowledge-base/references/mcp-gateway-registry/tests/unit/test_lifecycle_status.py:67-80`
documenta o mecanismo em dois casos nomeados:

- `test_documents_without_status_field_pass_through` — o filtro contém a cláusula
  `{"status": {"$exists": False}}` (linha 73), então documento antigo, sem o campo, **passa**.
- `test_documents_without_is_enabled_field_pass_through` — idem, `{"is_enabled": {"$exists": False}}`
  (linha 80).

Somado a isso, os **defaults dependem da origem** (`test_lifecycle_status.py:121-165`):

| Origem | Default | Linha | Razão |
|---|---|---|---|
| Registro novo (`SkillRegistrationRequest`) | `draft` | 144-153 | O que entra agora começa em rascunho |
| Ativo pré-existente (`SkillCard`) | `active` | 155-165 | *"backwards compat"* — o que já existia continua ativo |

Isso é o padrão inteiro: **o campo novo nasce opcional, o filtro tolera sua ausência, e o default
difere entre "coisa nova" e "coisa que já existia"**.

**Veredito de portabilidade — e ele é um "não" parcial.** O mecanismo do `$exists: false` é natural
em banco de documentos: o documento antigo literalmente não tem a chave. No nosso Postgres com
Drizzle, a migração adiciona **coluna com default**, e toda linha antiga passa a ter o valor — não
existe "linha sem a coluna". O que **é** portável é a decisão de produto: *linha pré-existente vira
`active`, registro novo vira `draft`*. O mecanismo não se copia; a semântica sim.

---

## Coverage Corner 4 — Techniques

### Q1 — como é modelado? **Duas dimensões ortogonais, string validada contra Enum — e sem State pattern.**

**O vocabulário** vive em
`.claude/knowledge-base/references/mcp-gateway-registry/registry/schemas/registry_card.py:27` —
`class LifecycleStatus(str, Enum)`, com os quatro valores confirmados em
`test_lifecycle_status.py:113`: `active`, `deprecated`, `draft`, `beta`.

**Os campos** no modelo de skill
(`.claude/knowledge-base/references/mcp-gateway-registry/registry/schemas/skill_models.py`):

| Campo | Tipo declarado | Default | Linha |
|---|---|---|---|
| `is_enabled` | `bool` | `True` | 240 |
| `status` | **`str`** (não `LifecycleStatus`) | `active` em cards existentes; `draft` em registro novo | 270, 364, 404-406, 483 |
| `health_status` | `Literal["healthy","unhealthy","unknown"]` | `unknown` | 242, 358 |

Note a assimetria deliberada: `health_status` é `Literal` tipado, `status` é `str` validado por
função. O peer escolheu validação em runtime para o campo de ciclo de vida.

**A ortogonalidade é provada por teste, não inferida.** `test_lifecycle_status.py`:

- `test_include_disabled_still_filters_status:58-65` — pedir os desabilitados **não** desliga o
  filtro de estágio: `draft` e `deprecated` continuam excluídos.
- `test_include_draft_and_deprecated_only_filters_disabled:82-90` — o inverso: incluir os dois
  estágios deixa **apenas** o filtro de habilitação (`{"is_enabled": True}`).

As duas dimensões compõem-se sem se anular. É a definição operacional de ortogonal.

**Sobre design pattern — a resposta honesta é "não usa State, e não precisa".** O que existe:

| Padrão | Onde | Forma |
|---|---|---|
| **Enum** (vocabulário fechado) | `registry_card.py:27` | `class LifecycleStatus(str, Enum)` |
| **Specification** (em forma funcional) | `search_repository.py:379` | `_build_status_filter(include_draft, include_deprecated, include_disabled)` constrói o predicado de consulta a partir de flags |
| **Repository + interface** (DIP) | `registry/repositories/interfaces.py` (2229 linhas) e `.../documentdb/` | a implementação DocumentDB satisfaz a interface; o serviço não conhece o banco |
| **State pattern** | — | **ausente** |

E ausente com razão: State pattern paga por si quando cada estado tem **comportamento polimórfico**.
Aqui os estados não têm comportamento — eles são **critério de filtro**. Introduzir quatro classes de
estado para representar quatro strings seria cerimônia (`rules/parsimony-ladder.md` rung 1: a
abstração precisa se justificar como o código precisa). O que carrega comportamento é o **construtor
de filtro**, e esse sim é um padrão que vale copiar.

### Q2 — quais transições são permitidas, e onde? **Nenhuma restrição. Valida-se o valor, não a transição.**

`_validate_lifecycle_status` (`registry_card.py:36-47`) faz uma coisa só: confere a string contra
`allowed = {s.value for s in LifecycleStatus}` (linha 47) e levanta `ValueError` se não pertencer.
Normaliza para minúsculas antes (`test_status_normalized_to_lowercase:101`).

No serviço, a escrita é atribuição direta:
`.claude/knowledge-base/references/mcp-gateway-registry/registry/services/skill_service.py:1192` —
`status=request.status`. Não há verificação de estado anterior, não há matriz origem→destino, não há
`can_transition_to`.

| Origem → Destino | Permitida? | Onde é verificado |
|---|---|---|
| qualquer → qualquer (dos 4 valores) | **Sim** | em lugar nenhum — só o valor é validado |
| qualquer → valor fora do enum | Não | `registry_card.py:47` (`ValueError`) |

**Isto é decisão, não esquecimento** — e tem custo. Nada impede `deprecated → draft`, que semanticamente
é ressuscitar uma skill descontinuada como rascunho. Se isso importa para nós, a máquina de
transições é **nossa** a construir, e o blueprint não tem prior art para oferecer.

### Q3 — efeito por estado: descoberta vs listagem vs resolução

Derivado de `_build_status_filter` (`search_repository.py:379`) e dos oito casos de
`test_lifecycle_status.py:12-90`. **O default exclui os três** — draft, deprecated e disabled
(`test_default_excludes_draft_and_deprecated_and_disabled:12-28`) — e cada um tem opt-in próprio:

| Estado | Aparece na **busca**? | Opt-in | Resolve **por id**? |
|---|---|---|---|
| `active` + enabled | Sim | — | Sim |
| `draft` | **Não** | `include_draft=True` (`:39-47`) | **Sim** (`skill_repository.py:190-197`) |
| `deprecated` | **Não** | `include_deprecated=True` (`:49-56`) | **Sim** (idem) |
| desabilitada (`is_enabled=False`) | **Não** | `include_disabled=True` (`:58-65`) | **Sim** (idem) |
| sem o campo (legado) | **Sim** | — | Sim (`:67-80`) |

`test_include_all_returns_empty_dict:30-37` fecha o desenho: pedir tudo devolve filtro **vazio** — o
opt-in total não é um caso especial no código, é a ausência de restrição.

**A coluna de listagem ficou sem medição independente.** O checkpoint EC-4 do plano exigia três
colunas com citação própria; obtive duas. Todos os usos de `_build_status_filter` estão no
`search_repository`, o que sugere que a listagem passa pelo mesmo caminho, mas **não confirmei qual
das quatro chamadas serve listagem e qual serve busca semântica**. Registro como parcial em vez de
inferir — a diferença importa para a nossa `GET /v1/skills`.

---

## ADRs

### D1 — Adotar duas dimensões ortogonais, não um enum único

**Decisão:** o domínio ganha `lifecycle` (estágio: `active` · `draft` · `deprecated`) **e** mantém
separada a habilitação, em vez de um único enum com todos os valores.

**Rationale:** provado ortogonal por teste no peer (`test_include_disabled_still_filters_status:58`,
`test_include_draft_and_deprecated_only_filters_disabled:82`). Um enum único obrigaria a inventar
combinações (`deprecated_and_disabled`) e o número de valores cresceria multiplicativamente a cada
dimensão nova.

**Alternativas consideradas:**

1. **Enum único** (`ACTIVE|DRAFT|DEPRECATED|DISABLED|DELETED`). Rejeitada: "desligada" e
   "descontinuada" respondem perguntas diferentes — a primeira é operacional e reversível, a segunda
   é editorial e carrega motivo. Colapsá-las perde a capacidade de desligar temporariamente algo que
   não está descontinuado.
2. **Só `is_enabled`, sem estágio.** Rejeitada: não distingue "ainda não publiquei de verdade"
   (draft) de "não use mais" (deprecated), que exigem mensagens opostas ao consumidor.
3. **`beta` como quarto estágio, como o peer.** Rejeitada por YAGNI: temos canais (`stable`, `beta`)
   desde o M19, que já resolvem maturidade por revisão. Um `beta` no estágio da skill duplicaria o
   conceito em outra dimensão.

**Consequences:** o `state` atual (`ACTIVE`/`DELETED`) **não** é substituído — ele é ortogonal a
ambos (uma skill apagada não tem estágio). Três conceitos convivem, e o ADR de implementação deve
declarar a tabela.

### D2 — Filtrar na busca, nunca na resolução por id

**Decisão:** o ciclo de vida afeta `:retrieve` e a listagem; `GET /v1/skills/:id` e a resolução de
instrução **ignoram** o estado.

**Rationale:** é a garantia que faz a deprecação não quebrar consumidor, e o peer a obtém
estruturalmente — `_build_status_filter` só existe no caminho de busca
(`search_repository.py:1344,1733,2097,2355`) e o `get` não o chama (`skill_repository.py:190-197`).

**Alternativas consideradas:**

1. **Negar o payload da deprecada.** Rejeitada: é a definição de quebrar quem já usa — o efeito que o
   milestone existe para evitar.
2. **Devolver com aviso no corpo.** Rejeitada por ora: muda o contrato de leitura para todo
   consumidor. O aviso pertence ao campo de metadados (D3), não ao envelope da resposta.

**Consequences:** precisamos de **teste de regressão** — o peer não tem, e sem ele a garantia é só
convenção. Vira item de DoD.

### D3 — Motivo e sucessora são nossos a desenhar, e são obrigatórios

**Decisão:** deprecar exige `reason`; `supersededBy` é opcional. Ambos viajam no contrato de leitura
até SDK, MCP e CLI.

**Rationale:** o peer **não tem** nenhum dos dois (grep exaustivo em `skill_models.py` → só a
descrição do campo `status`, linha 406). Não é prior art a copiar — é lacuna a preencher. Um agente
que recebe "deprecada" sem motivo nem alternativa tem a mesma informação de um 404.

**Alternativas consideradas:**

1. **Só um booleano `deprecated`.** Rejeitada pela razão acima.
2. **Motivo em texto livre sem sucessora.** Rejeitada parcialmente: o motivo sozinho ajuda o humano
   e não ajuda o agente. A sucessora é o que permite ação automática.
3. **Sucessora obrigatória.** Rejeitada: nem toda deprecação tem substituta ("esta capacidade saiu do
   produto"). Obrigar inventaria um ponteiro falso.

**Consequences:** campo novo no contrato de leitura, aditivo. E uma decisão de UX herdada: a tela
"diz o que deixa de valer" (DoD do M32) passa a ter conteúdo real para dizer.

### D4 — Validar valor agora; máquina de transições só com caso concreto

**Decisão:** validar que o estágio pertence ao vocabulário, com erro tipado. **Não** construir matriz
de transições permitidas nesta entrega.

**Rationale:** o peer não valida transição (`skill_service.py:1192` atribui direto) e não sofre com
isso. `rules/parsimony-ladder.md` rung 1: a máquina de estados precisa se justificar com casos
concretos, e hoje temos zero relatos de transição indevida — o recurso nem existe ainda.
`rules/error-handling.md` cobre o que importa: valor fora do vocabulário falha imediato e tipado.

**Alternativas consideradas:**

1. **Matriz completa de transições + State pattern.** Rejeitada: quatro estados sem comportamento
   polimórfico não pagam quatro classes. Seria a "generalização prematura" que a Regra 11 nomeia.
2. **Nenhuma validação.** Rejeitada: string livre no lugar de vocabulário fechado é como o campo
   `state` de hoje virou `text` sem constraint — dívida que o M32 está pagando.

**Consequences:** a DoD do M32 pede "tabela de combinações válidas testada". Este ADR **contradiz
parcialmente** essa formulação e a implementação deve reconciliar: proponho testar que as
combinações **compõem** (ortogonalidade, como o peer testa) em vez de proibir combinações — porque a
evidência não mostra combinação inválida. A decisão final é do `/to-plan`, com este trade-off à
vista.

---

## Cross-cutting Comparison

### O que NÃO adotar

| Do peer | Por que não |
|---|---|
| **`status` como `str` validado em runtime** | Nós temos TypeScript + Zod no contrato e Drizzle no schema; um union tipado dá a mesma garantia em tempo de compilação. A escolha do peer é imposta pelo Python, não é virtude |
| **`beta` como estágio** | Duplica o conceito de canal (M19). Maturidade é da **revisão**, não da skill |
| **`$exists: false` para retrocompatibilidade** | Mecanismo de banco de documentos. Em Postgres a coluna com default resolve, e tolerar NULL espalharia a condição por toda query |
| **Transição livre entre estágios** | Adotado por ora (D4), mas **registrado como risco**: `deprecated → draft` ressuscita uma descontinuada sem cerimônia |
| **Ausência de motivo/sucessora** | Lacuna do peer, explicitamente preenchida por D3 |
| **State pattern** | Não usado pelo peer, e não se justifica com estados sem comportamento (D4) |

## Recommendations

| # | Recomendação | Onde | Evidência |
|---|---|---|---|
| R1 | **Duas dimensões ortogonais**, distintas do `state` de exclusão | `packages/core` (domínio + schema) | D1; `test_include_disabled_still_filters_status:58` |
| R2 | **Filtro só no caminho de busca**; `get` por id intocado | `packages/api` (retrieve + store) | D2; `search_repository.py:1344,1733,2097,2355` vs `skill_repository.py:190-197` |
| R3 | **Teste de regressão que o peer não tem:** deprecada resolve por id | `packages/api/tests` | Q7 — a garantia é estrutural no peer; para nós vira teste |
| R4 | **Opt-in granular por estado** no `:retrieve`, com default excluindo | `packages/api` | Q3 — `include_draft` / `include_deprecated` / `include_disabled` separados |
| R5 | **`reason` obrigatório + `supersededBy` opcional**, aditivos no contrato de leitura | `packages/core/contract` + `packages/api` | D3 — lacuna do peer |
| R6 | **Migração aditiva:** coluna com default; linha pré-existente vira `active`, registro novo vira `draft` | `packages/core/.../migrations` | Q6 — semântica portável, mecanismo não |
| R7 | **Validar vocabulário com erro tipado**, sem matriz de transições nesta entrega | `packages/core/domain` | D4; `registry_card.py:47` |

## Limites desta descoberta

- **A coluna "listagem" da Q3 ficou parcial.** Confirmei busca e resolução por id; não determinei
  qual das quatro chamadas de `_build_status_filter` serve a listagem. O checkpoint EC-4 pedia três
  colunas independentes e entrego duas — a terceira precisa ser decidida por **nós** ao implementar
  `GET /v1/skills`, não herdada por inferência.
- **Não li `interfaces.py` (2229 linhas).** O Repository+DIP foi identificado pela estrutura de
  diretórios e pelos imports, não pela leitura da interface. A afirmação "usa DIP" é estrutural.
- **Não abri o `mcp-context-forge`.** O orçamento de D1 (1h) foi absorvido pela descoberta do
  `test_lifecycle_status.py`, que respondeu cinco questões de uma vez. A segunda opinião que D1
  queria **não foi obtida** — o blueprint generaliza a partir de **uma** amostra, e isso é uma
  limitação real, não um detalhe. Se o desenho de duas dimensões se mostrar problemático na
  implementação, esta é a primeira pedra a virar.
- **Nenhuma linha de código atravessou** (D4 do plano). O peer é Apache-2.0 e ainda assim nada foi
  copiado — Python/Pydantic/Mongo contra TypeScript/Zod/Postgres tornaria a cópia pior que o desenho
  próprio.
