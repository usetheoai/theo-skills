# Discovery Plan: M31 — as jornadas de skills, no nível do contrato de design

- **Version:** 1.1 — absorve os 2 MUST FIX de
  `knowledge-base/reviews/m31-skills-journeys-edge-cases-2026-08-03.md` (métodos de Q3 e Q7).
  Nenhuma pergunta mudou; nenhum escopo mudou. Só o caminho de busca, que nos dois casos
  produziria conclusão falsa em vez de erro visível.
- **Slug:** `m31-skills-journeys`
- **Milestone:** M31
- **Owner:** Paulo (sponsor)
- **Created:** 2026-08-03

## Context

A auditoria de 2026-08-03 (`knowledge-base/audits/2026-08-03-skills-ux-journeys.md`) navegou o
produto no `app-dev` por clique a partir da raiz e mediu: a `<main>` de `/skills` não tem um
único botão, a jornada termina em *0 versões → use a CLI*, e a API tem **1 de 7 escritas** com
superfície. `GET /v1/skills:retrieve` — a descoberta por intenção, razão de existir do produto —
não tem tela alguma.

O que **não** é discovery: a coreografia destrutiva já está escrita em
`theo-cloud/dashboard/DESIGN.md` §16, e temos duas implementações internas (`theo-trust`
guardrails, `theo-promptly` nova revisão). Copiar de nós mesmos não é pesquisa de prior art.

O que **é** discovery, e motiva este plano: **como se mostra a um operador POR QUE um resultado
apareceu numa busca híbrida**, sem transformar o painel num dump de debug. Ninguém no nosso
acervo resolve isso. E o M4 já registra o motivo de importar: a recall é carregada pelo FTS; a
perna vetorial isolada dá 0.308 com o embedder stub. Um painel que mostra score sem dizer de
onde ele veio esconde exatamente esse desequilíbrio.

**Pré-condição resolvida nesta sessão (#125):** o catálogo declarava 9 peers `cloned` e o disco
tinha zero — symlink pendurado sobre uma zona gitignored. Restaurados 4, os que servem a estas
perguntas. Todos os caminhos citados abaixo foram verificados com `find` antes de entrar aqui.

## Objective

Produzir um blueprint que responda **como projetar a explicabilidade de busca, a autoria com
validação prévia e a governança destrutiva** do registro de skills, em padrões aplicáveis
(design patterns / system design / OOP) — não em screenshots.

**Critério de sucesso mensurável:** o blueprint permite escrever o plano de implementação do M31
sem voltar a nenhuma fonte externa; toda decisão de design tem ≥ 1 citação a caminho real sob
`knowledge-base/references/`; e as três perguntas centrais têm resposta com trade-off explícito,
não descrição.

## In-Scope / Out-of-Scope

### In-Scope (por projeto de referência)

| Projeto | Em escopo | Por quê |
|---|---|---|
| `knowledge-base/references/semantic-router/` | `semantic_router/routers/`, `semantic_router/schema.py`, `semantic_router/index/` | Roteamento híbrido esparso+denso — o mesmo problema do nosso FTS × pgvector |
| `knowledge-base/references/mcp-gateway-registry/` | `registry/embeddings/`, `registry/services/`, `registry/audit/`, `registry/static/` | Registro com busca por embedding **e** superfície de operação |
| `knowledge-base/references/mcp-context-forge/` | `mcpgateway/admin_ui/`, `mcpgateway/templates/` | Admin UI de um gateway/registro — governança sobre item publicado |
| `knowledge-base/references/agentskills-spec/` | `docs/specification.mdx`, `skills-ref/` | A spec do formato: o que é validável antes de publicar |

### Out-of-Scope (explícito)

- **Todo `tests/` dos peers** exceto onde uma pergunta de cobertura o exige nominalmente (Q7).
  *Motivo:* o interesse é o padrão de design, não a suíte deles.
- `mcp-context-forge/charts/`, `docker/`, `mcp-servers/` — empacotamento e deploy, fora da
  pergunta.
- `mcp-gateway-registry/keycloak/`, `docker/`, `scripts/` — infraestrutura de auth e build.
- `semantic-router/docs/`, `*.ipynb` — material didático; o padrão vive no código.
- **Qualquer código de UI dos peers como fonte de layout.** Nosso layout é governado pelo
  `DESIGN.md` v1.0 (locked). Dos peers interessa a **decisão de informação** (o que mostrar),
  nunca o pixel.

## ADRs

### D1 — Time budget + stop conditions

| Projeto | Orçamento | Condição de parada por pergunta |
|---|---|---|
| `semantic-router` | 3h | Resposta encontrada **ou** 3 arquivos lidos sem sinal → marcar `blocked` com o motivo |
| `mcp-gateway-registry` | 2h | idem |
| `mcp-context-forge` | 2h | idem |
| `agentskills-spec` | 1h | idem |

Parada global: 8h ou 3 iterações consecutivas sem pergunta nova respondida.

### D2 — Profundidade da investigação

Leitura orientada por **símbolo**, não por arquivo inteiro: `grep` do conceito, depois `Read`
com `offset` na região. Justificativa: `mcp-context-forge` tem milhares de arquivos; ler por
varredura estoura o orçamento sem aumentar o sinal.

### D3 — Por que NÃO investigar a coreografia destrutiva nos peers com a mesma profundidade

O `DESIGN.md` §16 já prescreve a sequência inteira (DangerZone → ConfirmDialog → frase digitada
→ declaração de reversibilidade) e ela é **locked**. Dos peers interessa apenas uma coisa que o
contrato NÃO diz: **qual declaração de impacto se escreve quando a ação redireciona consumidores
de terceiros** (promover canal). Por isso a Q5 é única neste corner, em vez de três.

### D5 — (v1.1) A pergunta sobre declaração de impacto foi REMOVIDA, não deferida

A v1.0 perguntava que texto o `mcp-context-forge` escreve ao desativar um gateway registrado —
para emprestar a redação de impacto da promoção de canal. **Removida**, e a distinção importa:
não foi adiada por falta de orçamento; ela não precisa de peer.

O impacto de promover um canal é derivável do **nosso** domínio, e já está escrito na auditoria:
*"promover `stable` para `rev_x` aponta todos os consumidores deste canal para outro conteúdo;
reversível promovendo a revisão anterior."* Nenhum peer diria isso melhor — eles não têm o nosso
modelo de canal. E o `DESIGN.md` §16 já prescreve a coreografia inteira ao redor da frase.

Manter a pergunta custaria orçamento de descoberta para importar o que já sabemos. É a rung 1 da
escada de parcimônia aplicada à pesquisa: a investigação mais barata é a que não se faz.

**Alternativa considerada e rejeitada:** deferir para um plano de descoberta seguinte
(`m31-governance-copy`). Rejeitada porque criaria um artefato para uma pergunta que não tem
lacuna — deferir o desnecessário é a mesma dívida, com data.

### D4 — Nenhum peer é fonte de layout

Registrado como decisão porque a tentação é real: ver uma tela boa e copiar. Além do risco de
licença (`reference-provenance.md`), o `DESIGN.md` é locked e diverge deliberadamente. Dos peers
extraímos **o que informar**; o **como renderizar** é nosso.

## Research Questions

| # | Pergunta | Corner | Projeto(s) de referência | Fase A (largo — grep/find map) | Fase B (fundo — Read no hotspot) | Formato da resposta |
|---|---|---|---|---|---|---|
| Q1 | Como o híbrido combina score esparso e denso, e o resultado **preserva a contribuição de cada perna** ou colapsa num número só? | techniques | `knowledge-base/references/semantic-router/` | `Grep 'alpha\|sparse\|dense\|score' knowledge-base/references/semantic-router/semantic_router/routers/` | `Read knowledge-base/references/semantic-router/semantic_router/schema.py` (o tipo devolvido) **antes** de `Read .../routers/hybrid.py` (a combinação) | Assinatura do tipo + veredito: preserva / colapsa, e em que linha |
| Q2 | O `mcp-gateway-registry` expõe ao operador **por que** um servidor casou com a busca, ou só o ranking? | techniques | `knowledge-base/references/mcp-gateway-registry/` | `Grep 'score\|similarity' knowledge-base/references/mcp-gateway-registry/registry/services/ knowledge-base/references/mcp-gateway-registry/registry/static/` | `Read knowledge-base/references/mcp-gateway-registry/registry/embeddings/client.py` | Sim/não + evidência. **Ausência de score na UI É resposta válida**, não falha de busca |
| Q3 | Como o `agentskills-spec` define o que é validável **antes** de publicar, e o erro carrega posição (campo/linha)? | techniques | `knowledge-base/references/agentskills-spec/` | SKIP Fase A — documento único, sem mapa a construir | `Read knowledge-base/references/agentskills-spec/docs/specification.mdx` | Lista de regras validáveis + veredito sobre posição do erro |
| Q4 | Que dependências o peer usa para a perna léxica/esparsa, e alguma é alternativa real ao Postgres FTS que já temos? | deps | `knowledge-base/references/semantic-router/` | `Grep -i 'bm25\|sparse\|tfidf' knowledge-base/references/semantic-router/semantic_router/` | `Read knowledge-base/references/semantic-router/pyproject.toml` | Tabela dep → papel → **o FTS que já temos cobre? sim/não/parcial** (checkpoint 6) |
| Q5 | Existe teste que falha se uma das pernas do híbrido morrer — ou a suíte passa com metade desligada? | tests | `knowledge-base/references/semantic-router/` | `grep -rl 'hybrid' knowledge-base/references/semantic-router/tests/` | `Read knowledge-base/references/semantic-router/tests/unit/test_bm25_functional.py` | Nome do teste + **o que ele discrimina** (ou: não discrimina, e isso é o achado) |
| Q6 | Que ferramenta de build/lint/typecheck os peers de registro usam, e alguma resolve problema que hoje resolvemos à mão? | tools | `knowledge-base/references/mcp-gateway-registry/`, `knowledge-base/references/mcp-context-forge/` | SKIP Fase A — manifestos, forma de texto | `Read knowledge-base/references/mcp-gateway-registry/pyproject.toml`; `Read knowledge-base/references/mcp-context-forge/package.json` | Tabela ferramenta → papel → adotar/dispensar + motivo |

**Orçamento (v1.1 — corrigido):** 6 perguntas. `techniques` 3, `deps` 1, `tests` 1, `tools` 1 —
dentro do teto de 3 por corner e do mínimo de 1.

> **A v1.0 dizia "dentro do teto" com 5 perguntas em `techniques`. Era falso**, e o
> `discover-plan-confidence` reprovou com `question_budget_violated`. Corrigido dobrando duas
> perguntas numa (o tipo devolvido e a combinação vivem no mesmo par de arquivos, e a ordem
> entre elas já era um checkpoint) e removendo uma — ver ADR D5.

## Coverage Matrix

| Corner | Perguntas | Método declarado? | Gap |
|---|---|---|---|
| **tests** | Q5 | sim (Fase A + Fase B) | — |
| **deps** | Q4 | sim (Fase A + Fase B) | — |
| **tools** | Q6 | sim (Fase A = SKIP justificado + Fase B) | — |
| **techniques** | Q1, Q2, Q3 | sim (Fase A + Fase B) | — |

**Cobertura: 100%.** Nenhuma pergunta sem método; nenhum corner vazio; nenhum deferimento por
ADR necessário.

## Halt-loop Checkpoints

Antes de marcar qualquer pergunta como `done`, TODAS têm de valer:

1. A resposta cita **caminho real** sob `knowledge-base/references/` — verificado com `Read` na
   mesma iteração, não de memória.
2. A resposta é **específica** ("`HybridRouter.__call__` devolve `RouteChoice` com `similarity_score`"),
   nunca uma paráfrase ("o projeto trata score de forma sofisticada").
3. Quando a resposta contradiz a expectativa registrada no Context, a contradição é escrita —
   não apagada.
4. Pergunta sem resposta após o orçamento vira `blocked` **com o motivo**, jamais silêncio.

**(v1.1) Dois checkpoints vindos do edge-case review:**

5. **Q2 é respondida ANTES da Q1.** A Q1 pergunta se a contribuição de cada perna sobrevive ao
   resultado — e isso só se responde conhecendo o tipo devolvido, que é a Q2. Na ordem inversa,
   `hybrid.py` é lido duas vezes dentro de um orçamento de 3h.
6. **A Q6 só conta como `done` se disser, por dependência, se o Postgres FTS que já temos cobre
   aquilo.** O peer é Python com BM25; nós somos TypeScript com FTS nativo. Uma tabela de
   pacotes que não vamos usar preenche o corner e não informa nada — cobertura falsa é mais cara
   que corner vazio, porque ninguém volta nela.

## Acceptance Criteria

- [ ] As 8 perguntas em `done` **ou** `blocked` com motivo escrito.
- [ ] Toda citação resolve com `Path.exists()` — hard cap de fabricação do `discover-confidence`.
- [ ] Os quatro coverage corners populados no blueprint.
- [ ] ≥ 1 ADR no blueprint, com alternativas consideradas — não decisão sem contraditório.
- [ ] O blueprint declara explicitamente **o que NÃO se aplica a nós**, e por quê. Um blueprint
      que só diz "eles fazem X, façamos X" não pesquisou: comparou.
- [ ] Nenhuma linha de código de peer copiada — `reference-provenance.md` §5.

## Global Definition of Done

Verdict do `/discover-confidence` ≥ `SHIPPABLE_WITH_CAVEATS`, contra
`rules/discover-blueprint-golden-rule.md`. `INVALID` volta para `/discover-plan` (reescrita),
não para `/discover-improve`.

## Cross-references

- Regra do ciclo: `rules/cycle-discover.md`
- Contrato de projeto que os achados devem respeitar: `rules/architecture.md` (fronteiras e DIP)
  e `rules/testing.md` (pirâmide — qualquer técnica de teste emprestada tem de caber nela)
- Provenance da zona de estudo: `rules/reference-provenance.md`
- Auditoria que motivou: `knowledge-base/audits/2026-08-03-skills-ux-journeys.md`
- Contrato de design das telas: `theo-cloud/dashboard/DESIGN.md` v1.0 (locked)
- Catálogo dos peers: `knowledge-base/references-catalog.md`
