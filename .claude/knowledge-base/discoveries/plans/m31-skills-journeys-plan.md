# Discovery Plan: M31 — as jornadas de skills, no nível do contrato de design

- **Version:** 1.0
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

### D4 — Nenhum peer é fonte de layout

Registrado como decisão porque a tentação é real: ver uma tela boa e copiar. Além do risco de
licença (`reference-provenance.md`), o `DESIGN.md` é locked e diverge deliberadamente. Dos peers
extraímos **o que informar**; o **como renderizar** é nosso.

## Research Questions

| # | Pergunta | Corner | Método | Formato da resposta |
|---|---|---|---|---|
| Q1 | Como o `semantic-router` combina score esparso e denso, e o resultado **preserva a contribuição de cada perna** ou colapsa num número só? | Techniques | `Read knowledge-base/references/semantic-router/semantic_router/routers/hybrid.py`; `Grep 'alpha\|sparse\|dense\|score' semantic_router/routers/` | Trecho + veredito: preserva / colapsa, e onde |
| Q2 | Que forma de dado o `semantic-router` usa para devolver um resultado de rota (classe? dataclass? dict?), e o que ela carrega além do score? | Techniques | `Read knowledge-base/references/semantic-router/semantic_router/schema.py` | Assinatura do tipo + campos |
| Q3 | O `mcp-gateway-registry` expõe ao operador **por que** um servidor casou com a busca, ou só o ranking? | Techniques | `Grep -r 'score\|similarity\|rank' knowledge-base/references/mcp-gateway-registry/registry/` | Sim/não + evidência do caminho |
| Q4 | Como o `agentskills-spec` define o que é validável **antes** de publicar, e o erro carrega posição (campo/linha)? | Techniques | `Read knowledge-base/references/agentskills-spec/docs/specification.mdx` | Lista de regras + veredito sobre posição do erro |
| Q5 | Que declaração de impacto o `mcp-context-forge` escreve para ação que afeta consumidores já conectados (desativar/remover um gateway registrado)? | Techniques | `Grep -ri 'confirm\|delete\|deactivate' knowledge-base/references/mcp-context-forge/mcpgateway/admin_ui/ knowledge-base/references/mcp-context-forge/mcpgateway/templates/` | Texto literal + o que ele nomeia como consequência |
| Q6 | Que dependências os peers usam para a perna léxica/esparsa, e alguma é alternativa real ao Postgres FTS que já temos? | Dependencies | `Read knowledge-base/references/semantic-router/pyproject.toml`; `Grep -i 'bm25\|sparse\|tfidf' semantic_router/` | Tabela dep → papel → aplicável a nós? |
| Q7 | Como o `semantic-router` testa que o híbrido de fato mistura as duas pernas — existe teste que falha se uma delas morrer? | Integration tests | `find knowledge-base/references/semantic-router -path '*test*' -name '*hybrid*'`; ler o que casar | Nome do teste + o que ele discrimina |
| Q8 | Que ferramenta de build/lint/typecheck os peers de registro usam, e alguma resolve problema que hoje resolvemos à mão? | Tools | `Read knowledge-base/references/mcp-gateway-registry/pyproject.toml`; `Read knowledge-base/references/mcp-context-forge/package.json` | Tabela ferramenta → papel → adotar/dispensar + motivo |

**Orçamento:** 8 perguntas. Techniques 5, Dependencies 1, Integration tests 1, Tools 1 — dentro
do teto de 3 por corner e do mínimo de 1 por corner.

## Coverage Matrix

| Corner | Perguntas | Método declarado? | Gap |
|---|---|---|---|
| **Integration tests** | Q7 | sim | — |
| **Dependencies** | Q6 | sim | — |
| **Tools** | Q8 | sim | — |
| **Techniques** | Q1, Q2, Q3, Q4, Q5 | sim | — |

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
