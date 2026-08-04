# Discovery Plan: UX de catálogo — como um registro de skills é navegado por quem não sabe o que procura

> **Version 1.1** — revisada por `/discover-edge-cases` em 2026-08-03, que absorveu EC-1 a EC-4 de
> `.claude/knowledge-base/reviews/skills-catalog-ux-edge-cases-2026-08-03.md`: quatro alvos estavam
> errados (o peer tem `SkillCard.tsx` com 887 linhas, que o v1.0 não citava; `AuditFilterBar.tsx`
> não conta faceta alguma — medido `grep -c count` → 0; a contagem vive em `pages/Dashboard.tsx`;
> e o teste da jornada é `DiscoverTab.test.tsx`, não os testes de componente).
>
> O plano `m31-skills-journeys-ui` entrega uma `DataTable` com busca e paginação:
> resolve *"não perder skill acima de 100"*, não resolve *"não sei o que existe, me mostre"*. Esta
> descoberta investiga a superfície de **catálogo/galeria** em dois registries reais clonados —
> `mcp-gateway-registry` (React, com `cards/`, `EntityGrid`, `DiscoverTab`) e `mcp-context-forge`
> (admin server-rendered, com partial de registry e de *top performers*) — mais o formato canônico
> em `agentskills-spec`, para decidir **quando card vence tabela**, **de onde vem a contagem por
> faceta**, **que sinal de adoção é honesto exibir** e **o que não adotar**. Saída: blueprint com
> ADRs que revisam o plano do M31 para v1.1.

**Slug:** `skills-catalog-ux`
**Owner:** usetheodev
**Created:** 2026-08-03
**Time budget:** 6h (quebra por projeto em D1 — subiu de 5h por EC-4)

## Context

Três fatos motivam esta descoberta agora, e nenhum deles é opinião.

1. **O plano do M31 não cobre a jornada de navegação.** `.claude/knowledge-base/plans/m31-skills-journeys-ui-plan.md`
   § T1.3 entrega busca + paginação numa `DataTable`. A DoD do M31 pede que "o acervo aguente
   escala" — e isso ele cumpre. Mas nenhuma das quatro personas mapeadas em
   `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` § "As três pessoas, e as
   jornadas que faltam" é *quem procura sem saber o que quer*. Essa persona não foi desenhada por
   ninguém.

2. **O blueprint anterior investigou outra coisa.**
   `.claude/knowledge-base/discoveries/blueprints/m31-skills-journeys-blueprint.md` § "Objective"
   declara o alvo: *"a explicabilidade de busca, da autoria com validação prévia e da governança
   destrutiva"*. Ele foi atrás de `semantic-router` e das camadas de **serviço** do
   `mcp-gateway-registry`. A superfície de catálogo dos peers não foi aberta.

3. **Há sinal no domínio sem tela que o mostre.** O `ROADMAP.md` registra M23 (categoria e modo de
   execução), M14 (visibilidade e catálogo público curado) e M21 (telemetria de adoção para o
   publisher) como `[x]`. São exatamente os três insumos que um card de catálogo exibiria — e o
   painel não exibe nenhum.

O gatilho imediato foi o dono do projeto apontar duas referências visuais de marketplace de skills
(chips de tag com contagem, filtro por plataforma e contributor, `Sort by`, cards com formato,
curtidas e downloads) e perguntar se a UX havia sido pesquisada. Havia — para retrieval, não para
galeria. Esta é a lacuna.

Regras do projeto que qualquer padrão importado terá de respeitar: `rules/architecture.md`
(fronteiras — a tela fala com o BFF, nunca com o registry), `rules/parsimony-ladder.md` (rung 4:
reusar dependência já instalada antes de adicionar) e `rules/public-copy.md` (nenhum número exibido
sem lastro medido).

## Objective

**Decidir a forma da superfície de catálogo de skills** — card vs tabela, quais facetas existem, de
onde vem cada número e quais são honestos — com evidência de dois registries reais e um veredito
explícito sobre o que **não** adotar.

- [ ] Todas as questões respondidas com citação a `.claude/knowledge-base/references/`
- [ ] Tabela comparativa preenchida para os dois registries em escopo
- [ ] Ao menos uma proposta de decisão concreta por questão
- [ ] Seção explícita "o que NÃO adotar", com razão
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (por projeto de referência)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mcp-gateway-registry/` | `frontend/src/components/SkillCard.tsx`, `frontend/src/types/skill.ts`, `frontend/src/components/SkillResources.tsx`, `frontend/src/components/cards/`, `frontend/src/components/entities/`, `frontend/src/components/DiscoverTab.tsx`, `frontend/src/components/DiscoverListRow.tsx`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/components/__tests__/DiscoverTab.test.tsx`, `frontend/src/pages/__tests__/Dashboard.test.tsx`, `frontend/package.json`, `frontend/e2e/` | Único peer clonado com catálogo React completo — e tem **card de skill literal** (`SkillCard.tsx`, 887 linhas, medido) com seu modelo de dados (`types/skill.ts`, 105). Tem card e linha ao mesmo tempo (`DiscoverTab` + `DiscoverListRow`), grade (`EntityGrid`), estatística (`CardStatsRow`), chips (`TagList`), e o filtro por tag mora no pai (`Dashboard.tsx` — 41 sinais de faceta em 3157 linhas, medido). Apache-2.0 |
| `.claude/knowledge-base/references/mcp-context-forge/` | `mcpgateway/templates/mcp_registry_partial.html`, `mcpgateway/templates/metrics_top_performers_partial.html`, `mcpgateway/templates/agents_partial.html` | A outra metade da pergunta: catálogo **server-rendered**, com um partial dedicado a *top performers* — o lugar onde o sinal de adoção aparece. Apache-2.0 |
| `.claude/knowledge-base/references/agentskills-spec/` | `docs/specification.mdx`, `docs/skill-creation/optimizing-descriptions.mdx` | Quais campos o formato canônico define (candidatos a faceta) e qual o papel da descrição na escolha da skill — a descrição é o que a busca indexa **e** o que o card mostra |

### Out-of-Scope (explícito)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/semantic-router/` | Inteiro. É retrieval, já coberto pelo blueprint `m31-skills-journeys`; re-investigar duplicaria trabalho sem responder nada de catálogo |
| `.claude/knowledge-base/references/mcp-gateway-registry/` — `registry/`, `auth_server/`, `agents/`, `cli/`, `terraform/`, `charts/`, `keycloak/`, `infra/` | Backend, infraestrutura e autenticação. A pergunta é de superfície; o backend do peer não governa a nossa |
| `.claude/knowledge-base/references/mcp-context-forge/` — `mcpgateway/` exceto os três templates listados; `plugins/`, `crates/`, `charts/`, `ansible/`, `supply-chain/` | Mesma razão. Do context-forge interessa só a forma da tela de registry e de top performers |
| `.claude/knowledge-base/references/agentskills-spec/` — `docs/client-implementation/`, `docs/skill-creation/` exceto `optimizing-descriptions.mdx`, `skills-ref/` | Fora da pergunta de catálogo. `evaluating-skills.mdx` é material do M32 (evals) e será alvo de descoberta própria — anotado, não puxado para cá |
| `cat-agent-skills` | **Não está clonado.** Aparece em `.claude/knowledge-base/references-catalog.md` mas não existe na zona (verificado por `ls`). Citá-lo seria fabricação — hard cap do `discover-plan-golden-rule` § 1.2 |
| Qualquer projeto não clonado | Nunca afirmar característica de projeto sem ler a fonte |

## ADRs

### D1 — Orçamento de tempo e condições de parada

**Decisão:** `mcp-gateway-registry`: **4h** · `mcp-context-forge`: 1h · `agentskills-spec`: 1h.

> **Revisão v1.1 (EC-4).** Subiu de 3h para 4h porque a correção de alvos concentrou 5.244 linhas
> medidas nesse peer: `Dashboard.tsx` (3157) + `SkillCard.tsx` (887) + `DiscoverTab.tsx` (732) +
> `DiscoverTab.test.tsx` (468). Manter 3h com esse volume seria planejar o estouro.

**Rationale:** o gateway-registry é o único peer com catálogo React completo e é onde estão 6 das 8
questões; o context-forge entra por **uma** pergunta específica (origem do número de adoção) e não
justifica mais que 1h; a spec é leitura de dois documentos. Alternativas consideradas: divisão igual
entre os três (rejeitada — trataria 3 arquivos HTML como equivalentes a um frontend de 9
diretórios); mergulho único no gateway-registry (rejeitada — perderia a comparação
client-side × server-side, que é justamente a Q3).

**Stop condition — por questão (obrigatória):** quando a Fase A de uma questão retornar vazio após 3
tentativas com variantes diferentes (padrão AST → busca por nome de arquivo → caminho alternativo →
escopo mais amplo), marcar a questão BLOCKED com motivo *"Fase A esgotada"* e seguir. Não preencher
com hotspots de outra questão.

**Stop condition — por projeto (obrigatória):** orçamento esgotado com questões pendentes → marcar
as restantes daquele projeto como BLOCKED com motivo *"budget exhausted"* e avançar. Se todos os
projetos chegarem a esse estado, emitir `<promise>BLUEPRINT_BLOCKED</promise>` — nunca
`BLUEPRINT_COMPLETE` a partir de estado com questão bloqueada.

**Anti-pattern:** NUNCA fabricar resposta de Fase B para fechar questão cuja Fase A esgotou
(Unbreakable Rule 3).

**Consequences:** o blueprint pode sair com questões bloqueadas explícitas; elas viram semente da
próxima descoberta em vez de virarem afirmação sem lastro.

### D2 — Profundidade: ler os componentes de card inteiros, mapear os grandes por AST

**Decisão:** os arquivos pequenos de composição (`cards/*.tsx`, `entities/EntityGrid.tsx`,
`entities/EmptyState.tsx` — todos ≤ ~72 linhas, medido) são lidos **de ponta a ponta**. Os grandes
(`DiscoverTab.tsx` 732 linhas, `AuditFilterBar.tsx` 428, `DiscoverListRow.tsx` 362 — medidos por
`wc -l`) entram por Fase A (mapa de hotspots) e só os hotspots são lidos.

**Rationale:** a decisão de design mora na **composição** — o que o card escolhe exibir — e essa
informação está inteira nos arquivos pequenos. Ler 1.500 linhas de aba de descoberta para achar a
mesma resposta gastaria o orçamento sem aumentar a evidência. Alternativas: ler tudo (rejeitada —
estoura D1); só Fase A em tudo (rejeitada — um mapa de AST não mostra *por que* o autor pôs
`CardStatsRow` no rodapé e não no cabeçalho, e é esse porquê que decide a nossa tela).

**Terceira classe (v1.1, EC-4) — o arquivo central da questão.** Um arquivo entre ~100 e ~1000
linhas que é o **alvo principal** de uma questão (hoje: `SkillCard.tsx`, 887) não cabe em nenhuma
das duas classes acima: lê-lo inteiro custa caro, e mapeá-lo por AST responde *"quais funções
existem"* quando a pergunta é *"o que o autor escolheu exibir, e por quê"*. Regra: **Fase A para
localizar o bloco de render, depois leitura integral daquele bloco** — não do arquivo.

**Consequences:** conclusões sobre `DiscoverTab` e `Dashboard.tsx` serão sobre os trechos lidos, não
sobre o arquivo inteiro — e o blueprint dirá isso. Sobre `SkillCard.tsx`, o bloco de render é lido
por completo, então a conclusão sobre a anatomia do card é integral.

### D3 — Nenhuma linha de código dos peers atravessa para o projeto

**Decisão:** o produto desta descoberta é **decisão de design em prosa**, com citação `path:line`.
Nenhum trecho é copiado, nem "adaptado".

**Rationale:** `rules/reference-provenance.md` § 3 — a zona é para ler e entender; cópia carrega a
licença do original para dentro do projeto, o que é problema jurídico, não estilístico. Os dois
peers são Apache-2.0, o que **permitiria** o uso com atribuição — e mesmo assim não copiamos, porque
a regra do projeto é mais estrita que a licença e não precisamos: o `@usetheo/ui` já tem os
primitivos. Alternativa considerada: portar `CardStatsRow` (35 linhas) por ser trivial — rejeitada,
é exatamente o tamanho de arquivo que se reescreve em cinco minutos.

**Consequences:** o blueprint terá tabelas de decisão e não trechos de código do peer.

### D4 — A honestidade do número é critério de aceite, não observação

**Decisão:** toda faceta ou métrica que a descoberta recomendar exibir precisa vir com a resposta a
*"nós medimos isso?"*. Recomendação sem lastro medido é rejeitada no próprio blueprint.

**Rationale:** `rules/public-copy.md` § 5 proíbe número não medido em superfície pública, e a
auditoria de 2026-08-04 § "Achado colateral" já flagrou o custo disso: o rodapé afirma "10
operational" enquanto a tela ao lado diz que o serviço está inalcançável. Um card que exibe
"1.2K downloads" derivado de coisa nenhuma é o mesmo defeito com outra roupa.

**Consequences:** a Q3 pode concluir que **não devemos** exibir sinal de adoção agora — e isso é
resultado válido, não fracasso da descoberta.

## Research Questions

Cada questão declara Fase A (mapa amplo) e Fase B (leitura profunda). Onde a pergunta é de texto
(HTML/MDX/JSON), a Fase A é `Glob`/`Grep` e está declarado.

| # | Question | Corner | Reference project(s) | Fase A (broad — mapa) | Fase B (deep — Read no hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | O peer mantém **card e linha** para o mesmo acervo (`DiscoverTab.tsx` + `DiscoverListRow.tsx` coexistem). Qual critério faz um vencer o outro, e quem escolhe — o produto ou o usuário? | techniques | `mcp-gateway-registry/frontend/src/components/` | `ast-grep run -p 'const $NAME = ($$$) => { $$$ }' --lang tsx` sobre `DiscoverTab.tsx` e `DiscoverListRow.tsx` para mapear os blocos de render; fallback: `grep -n "view\|layout\|grid\|list\|toggle"` nos dois | Ler os hotspots de render + qualquer estado de alternância de visualização | Tabela: modo → quando é usado → quem decide → citação `path:line` |
| Q2 | Anatomia do card **de skill**: que campos do modelo viram slot, e o que cai em estatística, chip, estado e ação? | techniques | `mcp-gateway-registry/frontend/src/components/SkillCard.tsx` (887, medido), `frontend/src/types/skill.ts` (105), `frontend/src/components/SkillResources.tsx`, `frontend/src/components/cards/` | **v1.1 (EC-1):** ler `types/skill.ts` **inteiro** (é o modelo, e é pequeno); `ast-grep run -p 'return ($$$)' --lang tsx` em `SkillCard.tsx` para localizar o bloco de render (terceira classe de D2); primitivos de `cards/` lidos inteiros (35–72 linhas, medidos) | Ler o bloco de render de `SkillCard.tsx` por completo + `CardStatsRow`, `TagList`, `StatusDot`, `ToggleSwitch`, `InlineDeleteConfirm`, `entities/EntityGrid.tsx`, `entities/EmptyState.tsx` | Mapa: campo do modelo → slot do card → nosso equivalente (`category`? `execution`? `visibility`? `embedded`?) → **temos o dado?** → citação |
| Q3 | De onde vem o **número**: a contagem por faceta e o ranking de adoção são computados no servidor ou derivados no cliente — e o peer exibe algo que não mede? | techniques | `mcp-gateway-registry/frontend/src/pages/Dashboard.tsx`; `mcp-context-forge/mcpgateway/templates/mcp_registry_partial.html`, `.../metrics_top_performers_partial.html` | **v1.1 (EC-2):** o alvo era `AuditFilterBar.tsx` — medido `grep -c "count"` → **0**, é filtro de audit log. A contagem vive no pai: `grep -nE "tagCount\|counts\|tagFilter\|selectedTag" pages/Dashboard.tsx` → **41 ocorrências** em 3157 linhas. Fase A obrigatória; complementar com `ast-grep run -p 'useMemo($$$)' --lang tsx` | Ler os hotspots de agregação em `Dashboard.tsx` + os dois HTML | Tabela: número exibido → origem (servidor/cliente) → como o peer o obtém → **nós medimos isso?** (D4) |
| Q4 | Que dependências de UI o catálogo do peer exige (virtualização, fuzzy search, chips, ícones) — e alguma resolve algo que o `@usetheo/ui` já resolve? | deps | `mcp-gateway-registry/frontend/package.json` | SKIP Fase A — texto. `Read` do `package.json` inteiro | Ler `dependencies` + `devDependencies`; cruzar com o que o dashboard já declara | Tabela: dep → papel → **adotar / não adotar** + razão, por `rules/parsimony-ladder.md` rung 4 |
| Q5 | Que campos o formato canônico define — e quais são **facetáveis** por natureza (enumeráveis) vs livres? Qual o papel da `description` na escolha da skill? | deps | `agentskills-spec/docs/specification.mdx`, `agentskills-spec/docs/skill-creation/optimizing-descriptions.mdx` | SKIP Fase A — texto. `grep -n "^#\|required\|enum\|allowed"` em `specification.mdx` | Ler as seções de campos + o documento de descrição inteiro | Tabela: campo → obrigatório? → cardinalidade → serve como faceta? + o que a descrição precisa carregar |
| Q6 | Como o peer **testa** a superfície de catálogo — e que ferramenta ele usa que nós não temos? | tools | `mcp-gateway-registry/frontend/` (`playwright.config.ts`, `jest.config.cjs`, `package.json` scripts) | SKIP Fase A — texto. `Read` dos dois configs + scripts do `package.json` | Ler configs e a lista de specs em `frontend/e2e/` | Tabela: ferramenta → papel → **adotar / não adotar** (o dashboard já usa Vitest + Playwright) |
| Q7 | Existe teste que prova que **filtrar não perde item** — isto é, que a faceta contada bate com o conteúdo filtrado? | tests | **v1.1 (EC-3):** `mcp-gateway-registry/frontend/src/components/__tests__/DiscoverTab.test.tsx` (468, medido) e `frontend/src/pages/__tests__/Dashboard.test.tsx` como **primários**; `components/cards/__tests__/`, `.../entities/__tests__/` como secundários | `ast-grep run -p 'it($MSG, $$$)' --lang tsx` sobre `__tests__/DiscoverTab.test.tsx`; fallback `grep -n "filter\|count\|tag"` nele. Os `__tests__` de `cards/` e `entities/` contêm só testes de componente de apresentação (`CardFooter`, `StatusDot`, `TagList`, `ToggleSwitch`, `EmptyState`, `EntityGrid` — listado por `ls`), por isso deixaram de ser o alvo principal | Ler cada teste que casar com filtro/contagem | Lista: teste → o que asserta → **discrimina ou não** um filtro que perde item |
| Q8 | Como o peer distingue **vazio de busca** de **vazio de acervo** — e isso é testado? | tests | `mcp-gateway-registry/frontend/src/components/entities/EmptyState.tsx`, `.../entities/__tests__/EmptyState.test.tsx`, e **`components/__tests__/DiscoverTab.test.tsx`** (v1.1, EC-3 — é onde a busca sem resultado aparece) | SKIP Fase A no componente (pequeno); `grep -n "empty\|no results\|not found"` nos testes e em `e2e/` | Ler `EmptyState.tsx` inteiro + os testes que o exercitam | Resposta binária + citação; se não distinguir, registrar como defeito do peer a **não** copiar |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q7, Q8 | Covered |
| Dependencies | Q4, Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Total de questões: **8** (budget 5–10 ✓; máximo 3 por canto ✓; mínimo 1 por canto ✓).

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Antes de responder Qx | Todo caminho `.claude/knowledge-base/references/{...}` declarado na Fase A existe | BLOCKED com motivo "path not found"; seguir |
| Fase A por questão | Retornou ao menos um hotspot OU 3 variantes tentadas | Após 3 variantes vazias, BLOCKED "Fase A esgotada"; seguir |
| Depois de responder Qx | A seção da Qx tem ao menos uma citação `path:line` | Reiterar Qx (1 retry) |
| Q3 e Q2 especificamente | Toda métrica recomendada declara se **nós** a medimos (D4) | Reiterar com a coluna preenchida; sem ela a recomendação é rejeitada |
| Q3 — `metrics_top_performers_partial.html` (v1.1, EC-5) | Confirmar que a métrica ranqueada é de **uso** (chamadas/instalações), não de **desempenho** (latência/erro), antes de usá-la como evidência de sinal de adoção | Se for desempenho, responder *"o peer não exibe sinal de adoção no catálogo"* — resposta válida — em vez de forçar a analogia |
| Q4 e Q6 (v1.1, EC-6) | Nenhuma linha de "adotar/não adotar" fecha sem cruzar com `../theo-cloud/dashboard/package.json` | Ler o nosso `package.json` antes de fechar a tabela; sem o nosso lado, "já temos" é afirmação não verificada (`parsimony-ladder` rung 4) |
| Sanidade de meio de loop | Citações a `references/` ≥ 1 a cada 200 palavras de prosa | Adicionar citação aos parágrafos sem lastro (1 retry) |
| Orçamento por projeto | D1 não esgotado | Esgotou → BLOCKED nas restantes daquele projeto; avançar |
| Antes de prometer completo | Os 4 cantos com seção preenchida **e** a seção "o que NÃO adotar" não vazia | Recusar a promessa; continuar iterando |

## Acceptance Criteria

- [ ] Todas as 8 questões respondidas OU marcadas BLOCKED com motivo
- [ ] Os quatro cantos com seção preenchida no blueprint
- [ ] Toda citação aponta para caminho real em `.claude/knowledge-base/references/`
- [ ] Ao menos um ADR no blueprint sintetizando as decisões (card vs tabela; origem da contagem; sinal de adoção)
- [ ] Seção **"o que NÃO adotar"** presente e não vazia — um blueprint que só diz "eles fazem X, façamos X" não comparou nada
- [ ] Toda métrica recomendada tem a coluna "nós medimos isso?" respondida (D4)
- [ ] Orçamento de D1 respeitado
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `.claude/knowledge-base/discoveries/blueprints/skills-catalog-ux-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence → improve se preciso → re-score)
- [ ] Verdict final registrado no cabeçalho do blueprint
- [ ] Zero citações fabricadas — inclusive a de `cat-agent-skills`, que **não está clonado** e não pode aparecer
- [ ] Coverage Matrix 100%
- [ ] Os ADRs citam ao menos um princípio ou arquivo de regra do projeto — aqui: `rules/parsimony-ladder.md` (D3/Q4), `rules/reference-provenance.md` (D3), `rules/public-copy.md` (D4), `rules/architecture.md` (fronteira tela↔BFF)
- [ ] O blueprint declara explicitamente o que ele **não** investigou: `evaluating-skills.mdx` (material do M32) e a superfície de bundles/adoção do nosso próprio produto
