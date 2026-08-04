# Discovery Plan: ciclo de vida de skill — retirar de circulação sem quebrar quem já usa

> **Version 1.1** — revisada por `/discover-edge-cases` (2026-08-03), absorvendo EC-1 a EC-3 de
> `.claude/knowledge-base/reviews/m32-skill-lifecycle-edge-cases-2026-08-03.md`. A correção maior:
> existe `tests/unit/test_lifecycle_status.py` (165 linhas, 73 ocorrências, 16 casos) que responde
> **cinco** das oito questões — e o v1.0 apontava para `test_skill_models.py`, com 2 ocorrências.
>
> O M32 exige estados de ciclo de vida que permitam descontinuar uma skill sem
> quebrar consumidores. Hoje o domínio só sabe `ACTIVE` e `DELETED`, e apagar reserva o
> identificador. Esta descoberta investiga **como um registry real modela isso**: enum único ou
> dimensões ortogonais, onde as transições são validadas, e qual o efeito de cada estado na
> **descoberta** versus na **resolução** — a distinção que decide se a deprecação quebra ou não quem
> já referencia a skill. Saída: blueprint com ADRs de modelagem, máquina de estados e contrato.

**Slug:** `m32-skill-lifecycle`
**Owner:** usetheodev
**Created:** 2026-08-03
**Time budget:** 5h (quebra por projeto em D1)

## Context

O M32 nasceu de três fatos medidos, não de intuição.

1. **O domínio não tem vocabulário para "não use mais esta".**
   `packages/core/src/infrastructure/db/schema.ts:71` declara `state: text('state').notNull().default('ACTIVE')`
   e o único outro valor que o código escreve é `'DELETED'`
   (`packages/api/src/server/store/skills-store.ts:397`, que grava também `deletedAt` e
   `reservedUntil`). Não existe estado intermediário: ou a skill está viva, ou foi apagada **e o
   identificador ficou reservado**, o que quebra quem a referenciava.

2. **O formato canônico não ajuda.** `agentskills-spec` define seis campos e **nenhum** é de ciclo de
   vida (medido na descoberta `skills-catalog-ux`, § Q5). Logo, o lifecycle é decisão do **registro**
   — nossa, e sem respaldo de spec.

3. **Há prior art direta, e ela contraria o desenho mais óbvio.** A descoberta `skills-catalog-ux`
   encontrou, de passagem, que o peer separa `is_enabled: boolean` de
   `status: 'active' | 'draft' | 'deprecated' | 'beta'` como **dimensões ortogonais**
   (`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/types/skill.ts:73,95`), e
   que o desabilitado **sai do destaque sem sair do acervo**
   (`.../frontend/src/components/__tests__/DiscoverTab.test.tsx:325`). Aquela descoberta viu o
   **tipo do frontend**; o desenho de domínio — transições, enforcement, efeito na busca, migração —
   não foi aberto.

O dono do projeto exigiu explicitamente **design patterns, system design e OOP**. Isso torna uma
pergunta de primeira ordem: o peer modela o ciclo de vida com máquina de estados explícita / State
pattern, ou com `if` espalhado? A resposta muda o que copiamos e o que evitamos.

Regras que qualquer padrão importado terá de respeitar: `rules/architecture.md` (o domínio define a
interface, a infraestrutura implementa — DIP), `rules/testing.md` § 4.1 (caso negativo assere o erro
**tipado**, não só "lança") e `rules/error-handling.md` (transição inválida é violação de regra de
negócio → falha imediata, sem retry).

## Objective

**Decidir como modelar o ciclo de vida de uma skill** — quantas dimensões, quais transições, onde
validá-las e qual o efeito de cada estado na descoberta vs na resolução — com evidência de um
registry real e um veredito explícito sobre o que **não** adotar.

- [ ] Todas as questões respondidas com citação a `.claude/knowledge-base/references/`
- [ ] Tabela de estados × efeito (descoberta / resolução / listagem) preenchida
- [ ] Veredito sobre modelagem: ortogonal vs enum único, com o custo de cada uma
- [ ] Seção explícita "o que NÃO adotar"
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (por projeto de referência)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mcp-gateway-registry/` | `registry/schemas/skill_models.py` (519, medido), `registry/services/skill_service.py`, `registry/repositories/interfaces.py` (2229), `registry/repositories/documentdb/skill_repository.py` (478), `registry/repositories/documentdb/search_repository.py` (2769), `tests/unit/test_skill_models.py`, `tests/e2e_agent_skills_test.py` | Único peer com o ciclo de vida **implementado ponta a ponta**: modelo, serviço, repositório com **interface** (DIP) e repositório de busca — onde o efeito do estado na descoberta é decidido. Apache-2.0 |
| `.claude/knowledge-base/references/mcp-context-forge/` | `mcpgateway/` — apenas os módulos de modelo/serviço que declarem estado de entidade | Segunda opinião sobre modelagem, de um registry com desenho independente. Escopo estreito de propósito (D1) |
| `.claude/knowledge-base/references/agentskills-spec/` | `docs/specification.mdx` | Confirmar que o formato canônico **não** define lifecycle — ausência é resposta e precisa ser citável |

### Out-of-Scope (explícito)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mcp-gateway-registry/frontend/` | Inteiro. O tipo do frontend já foi lido na descoberta `skills-catalog-ux`; re-abrir duplicaria trabalho. Esta descoberta é de **domínio** |
| `.claude/knowledge-base/references/mcp-gateway-registry/` — `auth/`, `auth_server/`, `terraform/`, `charts/`, `keycloak/`, `infra/`, `egress_auth/`, `rate_limiting/`, `secrets/` | Nada a ver com ciclo de vida de entidade |
| `.claude/knowledge-base/references/mcp-gateway-registry/registry/services/skill_scanner.py` | Varredura de segurança — outra preocupação; entraria só se o scan participasse da transição de estado, o que a Q2 confirmará ou negará sem precisar abrir o arquivo |
| `.claude/knowledge-base/references/semantic-router/` | Inteiro. É retrieval, não tem modelo de entidade com ciclo de vida |
| `cat-agent-skills` | **Não clonado.** Citá-lo é fabricação (`discover-plan-golden-rule` § 1.2) |

## ADRs

### D1 — Orçamento e condições de parada

**Decisão:** `mcp-gateway-registry`: 3.5h · `mcp-context-forge`: 1h · `agentskills-spec`: 0.5h.

**Rationale:** o gateway-registry concentra 6 das 8 questões e é o único com implementação completa;
o context-forge entra como **segunda opinião** para evitar que o blueprint generalize a partir de uma
amostra de um; a spec é confirmação de uma ausência já observada (30 min bastam). Alternativas:
divisão igual (rejeitada — trataria confirmação de ausência como equivalente a ler 6.000 linhas);
só o gateway-registry (rejeitada — uma amostra não distingue "boa prática" de "escolha daquele
time").

**Stop condition — por questão:** Fase A vazia após 3 variantes → BLOCKED com motivo, seguir.
**Stop condition — por projeto:** orçamento esgotado → BLOCKED nas restantes, avançar. Todos nesse
estado → `<promise>BLUEPRINT_BLOCKED</promise>`.

**Anti-pattern:** nunca fabricar resposta de Fase B para fechar questão cuja Fase A esgotou
(Unbreakable Rule 3).

### D2 — Profundidade: o modelo inteiro, os arquivos grandes por hotspot

**Decisão:** `skill_models.py` (519) e **`tests/unit/test_lifecycle_status.py` (165)** são lidos
**inteiros** — são o objeto da pergunta. `interfaces.py` (2229), `search_repository.py` (2769) e
**`skill_service.py` (1741, medido em v1.1)** entram por Fase A e só os hotspots de
`is_enabled`/`status` são lidos. `skill_repository.py` (478): inteiro.

> **v1.1 (EC-2).** `skill_service.py` não tinha classificação no v1.0. São 1741 linhas com 33
> ocorrências: entra na classe "grande", e a Fase A da Q2 lê **apenas os hotspots que ESCREVEM
> estado** — a pergunta é sobre transição, não sobre leitura —, limitando-se a ~10 hotspots.

**Rationale:** a decisão de modelagem está no modelo e no teste dele; os repositórios grandes
interessam por **um** aspecto (como o estado entra na query), que a Fase A localiza com precisão.
Alternativa: ler tudo (rejeitada — 6.000 linhas estouram D1 sem aumentar a evidência sobre a
pergunta).

**Consequences:** conclusões sobre os repositórios grandes valem para os trechos lidos, e o blueprint
dirá isso.

### D3 — Perguntar por *pattern* explicitamente, e aceitar "não usa" como resposta

**Decisão:** a Q1 pergunta se há máquina de estados / State pattern **ou** `if` espalhado, e ambas as
respostas são válidas.

**Rationale:** o dono exigiu design patterns e OOP. O risco de uma pergunta assim é o viés de
confirmação — procurar `class *State` até achar algo e chamar de padrão. A honestidade aqui é
registrar *"o peer não usa; valida em N pontos espalhados"* se for o caso, porque isso também é
decisão de design e nos diz o que **não** copiar. `rules/parsimony-ladder.md` rung 1 aplica-se ao
padrão tanto quanto ao código: um State pattern com dois estados é cerimônia, não arquitetura.

**Alternativas consideradas:** não perguntar sobre pattern (rejeitada — é requisito explícito do
dono); assumir que precisa de State pattern (rejeitada — é a conclusão, não a pergunta).

**Consequences:** o blueprint pode recomendar **não** usar State pattern, e terá de justificar com o
número de estados e transições reais.

### D4 — Nenhuma linha de código do peer atravessa

**Decisão:** produto é decisão em prosa + citação `path:line`. Zero cópia, inclusive de modelo
Pydantic.

**Rationale:** `rules/reference-provenance.md` § 3. O peer é Apache-2.0 (permitiria com atribuição),
e ainda assim não copiamos: a regra do projeto é mais estrita que a licença, e nosso stack é
TypeScript/Drizzle contra Python/Pydantic — a tradução literal seria pior que o desenho próprio.

**Consequences:** o blueprint traz tabelas de decisão, não trechos.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — mapa) | Fase B (deep — Read no hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o ciclo de vida é **modelado**: enum único, dimensões ortogonais, ou outra coisa? Há máquina de estados explícita / State pattern, ou validação espalhada? | techniques | `mcp-gateway-registry/registry/schemas/skill_models.py` (519, 14 hits) **+ `tests/unit/test_lifecycle_status.py` (165, v1.1/EC-1)** | SKIP Fase A — os dois são o objeto da pergunta (D2). Ler inteiros | Ler `skill_models.py` e `test_lifecycle_status.py` por completo; `grep -n "class \|Enum\|Literal"` para inventariar tipos | Tabela: campo → tipo → valores → é enum/bool/outro; + veredito sobre pattern (usa / não usa / não se aplica). **`test_include_disabled_still_filters_status:58` é a evidência direta de ortogonalidade** |
| Q2 | Quais **transições** são permitidas e **onde** a validade é enforced — no modelo, no serviço, no repositório, no banco, ou em lugar nenhum? | techniques | `.../registry/services/skill_service.py`, `.../registry/schemas/skill_models.py` | `ast-grep run -p 'def $NAME($$$)' --lang python` em `skill_service.py` para listar operações; fallback `grep -nE "is_enabled\|status\|deprecat"` | Ler cada função que escreve estado | Matriz origem→destino com "permitida?" e a linha que decide; se não houver enforcement, dizer isso |
| Q3 | Qual o efeito de cada estado na **descoberta** vs na **resolução**? Exclui do destaque, da busca, ou nega o payload? | techniques | **primário (v1.1/EC-3):** `.../search_repository.py` (2769, **94 hits**) e `tests/unit/test_lifecycle_status.py`; **secundário:** `.../skill_repository.py` (478, **5 hits** — usado só para a metade "resolução por id") | `grep -nE "is_enabled\|status" search_repository.py` (Fase A obrigatória — 94 hotspots exigem disciplina); ler os 16 casos do `test_lifecycle_status.py` | Ler cada hotspot; distinguir filtro de listagem, de busca e de leitura por id | Tabela com **três colunas independentes**: estado → aparece na listagem? → aparece na busca? → resolve por id? Cada célula com citação própria (EC-4: inferir uma da outra invalida a resposta) |
| Q4 | O formato canônico define **algum** campo de ciclo de vida? E o que o peer **adiciona** por cima dele? | deps | `agentskills-spec/docs/specification.mdx`; `mcp-gateway-registry/registry/schemas/skill_models.py` | SKIP Fase A — texto. `grep -nE "^\|" specification.mdx` (tabela de campos) | Ler a tabela da spec + o modelo do peer, lado a lado | Tabela: campo → está na spec? → o peer adiciona? → nós temos? |
| Q5 | Como o **motivo** e a **sucessora** da deprecação viajam — existem no modelo do peer, e chegam ao consumidor? | deps | `.../registry/schemas/skill_models.py`, `.../registry/services/skill_service.py` | `grep -nE "reason\|replac\|successor\|superseded\|migration" skill_models.py skill_service.py` | Ler os campos/funções encontrados | Resposta binária + campos citados; se **não** existirem, registrar como lacuna do peer que nós preencheremos |
| Q6 | Como o peer faz **migração aditiva** de schema sem quebrar consumidor — há ferramenta, versionamento de documento, ou default no modelo? | tools | **primário (v1.1/EC-1):** `tests/unit/test_lifecycle_status.py:67,75` (`test_documents_without_status_field_pass_through`, `..._is_enabled_field_pass_through`); `.../registry/schemas/skill_models.py` | Ler os dois casos nomeados + `grep -nE "default\|migrat\|schema_version" skill_models.py skill_repository.py` | Ler os pontos de default/migração | Descrição do mecanismo + veredito: aplicável ao nosso Drizzle/Postgres ou **específico de banco de documentos** (EC-5 — não apresentar como portável sem dizer) |
| Q7 | Existe teste que prova que uma skill **desabilitada/deprecada continua resolvível** por quem a referencia? | tests | **primário (v1.1/EC-1):** `tests/unit/test_lifecycle_status.py` (165, 73 hits); **secundário:** `tests/e2e_agent_skills_test.py` (4 hits) | Ler os 16 casos de `test_lifecycle_status.py`; `grep -nE "def test_" tests/e2e_agent_skills_test.py` | Ler cada teste que casar | Lista: teste → o que asserta → **prova ou não** a resolução da deprecada. **Ausência é resposta** e deve ser afirmada, não omitida |
| Q8 | Existe teste que **reprova uma transição/combinação inválida** (ex.: desabilitada e `active` ao mesmo tempo)? | tests | **primário (v1.1/EC-1):** `tests/unit/test_lifecycle_status.py:106` (`test_invalid_status_rejected`), `:96`, `:101`, `:111`; **secundário:** `tests/unit/test_skill_models.py` (2 hits) | Ler os casos de validação nomeados; `grep -nE "raises\|invalid\|ValidationError"` nos dois | Ler cada caso negativo | Lista: caso → erro esperado → **tipado?** (`rules/testing.md` § 4.1 exige erro específico, não "lança"). Se o peer só testa valor inválido de campo e **não** combinação inválida entre os dois campos, isso é lacuna dele — e nossa DoD a preenche |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q7, Q8 | Covered |
| Dependencies | Q4, Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Total: **8 questões** (budget 5–10 ✓; máx 3 por canto ✓; mín 1 por canto ✓).

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Antes de responder Qx | Todo caminho declarado na Fase A existe | BLOCKED "path not found"; seguir |
| Fase A por questão | ≥ 1 hotspot OU 3 variantes tentadas | BLOCKED "Fase A esgotada"; seguir |
| Depois de responder Qx | Seção tem ≥ 1 citação `path:line` | Reiterar (1 retry) |
| **Q1 especificamente (D3)** | O veredito sobre pattern aceita "não usa" como resposta válida e não força um padrão inexistente | Reiterar com a resposta honesta |
| **Q3 especificamente** | A tabela distingue **descoberta** de **resolução** — colapsar as duas invalida a resposta | Reiterar; é a distinção que o M32 inteiro depende |
| **Q7 e Q8** | Ausência de teste é registrada como ausência, não como "não encontrei" | Reiterar com a afirmação explícita |
| Orçamento por projeto | D1 não esgotado | Esgotou → BLOCKED nas restantes |
| Antes de prometer completo | 4 cantos preenchidos **e** seção "o que NÃO adotar" não vazia | Recusar a promessa |

## Acceptance Criteria

- [ ] As 8 questões respondidas OU marcadas BLOCKED com motivo
- [ ] Os quatro cantos preenchidos
- [ ] Toda citação resolve em `.claude/knowledge-base/references/`
- [ ] Tabela **estado × efeito** (listagem / busca / resolução por id) completa — é o insumo direto da DoD do M32
- [ ] Veredito sobre modelagem (ortogonal vs enum) com o **custo** de cada uma, não só a preferência
- [ ] Seção "o que NÃO adotar" presente e não vazia
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint em `.claude/knowledge-base/discoveries/blueprints/m32-skill-lifecycle-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence)
- [ ] Verdict registrado no cabeçalho do blueprint
- [ ] Zero citações fabricadas — `cat-agent-skills` **não** pode aparecer
- [ ] Coverage Matrix 100%
- [ ] Os ADRs citam regra do projeto: `rules/architecture.md` (DIP no repositório), `rules/testing.md` § 4.1 (erro tipado no caso negativo), `rules/error-handling.md` (transição inválida falha imediata), `rules/parsimony-ladder.md` rung 1 (D3 — padrão precisa se justificar)
- [ ] O blueprint declara o que **não** investigou: o `skill_scanner.py` e a superfície de frontend do peer
