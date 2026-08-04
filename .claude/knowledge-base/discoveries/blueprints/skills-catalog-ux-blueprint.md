# Blueprint: UX de catálogo — como um registro de skills é navegado

> **Version 1.0** — Investiga a superfície de catálogo em dois registries reais (`mcp-gateway-registry`,
> React; `mcp-context-forge`, server-rendered) e no formato canônico (`agentskills-spec`) para decidir
> quando card vence tabela, de onde vem o número que a tela mostra, e que sinal de adoção é honesto
> exibir. **A conclusão principal contraria a expectativa que motivou a pesquisa:** o peer com
> catálogo maduro **não tem chips de tag contados** — ele filtra por tag sem exibir contagem. A
> contagem por faceta das referências visuais fornecidas não tem prior art aqui, e o blueprint diz
> isso em vez de inventar respaldo.

**Slug:** `skills-catalog-ux`
**Source plan:** `.claude/knowledge-base/discoveries/plans/skills-catalog-ux-plan.md` (v1.1)
**Owner:** usetheodev
**Generated:** 2026-08-03 via `/discover-execute` (executado em linha, não por ralph-loop — sessão interativa)
**Confidence verdict:** _(a preencher por `/discover-confidence`)_
**Perguntas:** 8 — 8 `done`, 0 `blocked`

## Context

O plano `m31-skills-journeys-ui` entrega uma `DataTable` com busca e paginação. Isso satisfaz o
critério "o acervo aguenta escala" do M31, mas não atende a persona *"não sei o que existe,
me mostre"* — a das duas referências visuais fornecidas pelo dono do projeto. Nenhuma auditoria
nem o blueprint `m31-skills-journeys` cobriu essa jornada: aquele investigou explicabilidade de
retrieval, declarado em seu próprio `## Objective`.

## Objective

Decidir a forma da superfície de catálogo — card vs tabela, quais facetas existem, de onde vem cada
número e quais são honestos — com evidência de peers reais e veredito explícito sobre o que **não**
adotar.

---

## Coverage Corner 1 — Integration Tests

### Q7 — existe teste que prova que **filtrar não perde item**? **Parcialmente — e a lacuna é reveladora.**

`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/components/__tests__/DiscoverTab.test.tsx`
(468 linhas) traz 14 casos. Os que importam:

| Linha | Caso | O que prova |
|---|---|---|
| 173 | `shows "no items matching" when keyword filter has no results` | o filtro sem resultado tem estado próprio |
| 241 | `keyword search filters custom records` | o filtro de fato filtra |
| 297 | `sorts servers by rating descending, alphabetical tiebreaker` | **ordenação determinística com desempate** — testada |
| 325 | `excludes disabled items from featured` | o item desabilitado **sai do destaque** — testado |
| 342 | `keyword search filters items instantly as you type` | filtragem incremental |
| 366 | `keyword search matches tags` | a busca textual **casa tags** |

**O que NÃO existe: nenhum teste sobre contagem.** Não há caso que asserte "o número ao lado da
faceta bate com a quantidade de itens que ela filtra". A razão apareceu na Q3: **o peer não exibe
contagem por faceta**. Não é lacuna de teste — é ausência do recurso.

**Consequência para nós, e ela é dupla.** Se adotarmos chips contados (que o peer não tem), estamos
sem prior art *e* sem teste de referência: a contagem é um número novo que a tela afirma, e o
`rules/public-copy.md` § 5 proíbe número não medido. O teste que prova contagem↔conteúdo teria de
ser escrito por nós, do zero. É exatamente a classe de defeito que o LT-035 deste projeto já pagou
uma vez: um agregado que passa enquanto metade do sistema está morta.

### Q8 — o peer distingue **vazio de busca** de **vazio de acervo**? **Sim, e testa os dois.**

Dois casos distintos, lado a lado, no mesmo arquivo:

- linha 166 — `shows empty state when no items registered` (acervo vazio)
- linha 173 — `shows "no items matching" when keyword filter has no results` (busca vazia)

O componente que os rende é
`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/components/entities/EmptyState.tsx`,
cujos próprios testes (`.../entities/__tests__/EmptyState.test.tsx`) cobrem, nas linhas 6-27:
título+subtítulo, ausência de subtítulo, **CTA quando fornecido** (linha 17) e **tom de erro para
falhas** (linha 22).

**Aplicável a nós, e já é regra nossa:** o `EmptyState` do peer trata *falha* como tom próprio, não
como "não há nada" — a mesma distinção que a auditoria de 2026-08-03 registra como uma das três
coisas que a tela de Skills **já faz certo**. O que falta do nosso lado é o terceiro estado: hoje
temos "vazio" e "falhou"; o catálogo precisa de "busca sem resultado", que é o caso da linha 173.

---

## Coverage Corner 2 — Dependencies

### Q4 — que dependências de UI o catálogo do peer exige? **Nenhuma que nos falte.**

`.claude/knowledge-base/references/mcp-gateway-registry/frontend/package.json` declara 17
dependências de runtime. Cruzadas com `../theo-cloud/dashboard/package.json` (medido):

| Dep do peer | Papel | Temos? | Adotar? |
|---|---|---|---|
| `clsx` | composição de classe | não | **Não** — o `@usetheo/ui` já resolve |
| `@headlessui/react` | primitivos acessíveis | não | **Não** — temos os composites canônicos |
| `@heroicons/react` | ícones | não (temos `lucide-react`) | **Não** — trocar família de ícone por catálogo é churn puro |
| `axios` | HTTP | não (temos `cloudFetch` + `@tanstack/react-query`) | **Não** |
| `date-fns` | datas | não | **Não** — nenhuma questão de catálogo precisa |
| `react-markdown` + `remark-gfm` | render de markdown | **sim** (`^9.1.0`) | já temos — útil para prévia do `SKILL.md` |
| `jszip`, `ajv` | zip e JSON-schema no browser | não | **Não** — validação é do servidor (D4 do plano do M31) |

**Veredito: adotar zero dependências.** E o achado que importa mais que a lista: **um catálogo com
facetas, cards, grade responsiva, ordenação e destaque não exigiu do peer nenhuma biblioteca de
virtualização, fuzzy-search ou chips.** Tudo é composição própria sobre React + Tailwind. Pela
`rules/parsimony-ladder.md` rung 4, a conclusão é direta: nossa stack basta, e propor uma dep nova
para catálogo precisaria justificar o que o peer conseguiu sem ela.

### Q5 — que campos o formato canônico define, e quais são facetáveis? **Seis campos, e quase nenhum serve de faceta.**

`.claude/knowledge-base/references/agentskills-spec/docs/specification.mdx:25-32`:

| Campo | Obrigatório | Restrição | Serve de faceta? |
|---|---|---|---|
| `name` | Sim | ≤ 64 chars; minúsculas, números, hífen; sem hífen inicial/final | Não — é identidade |
| `description` | Sim | ≤ 1024 chars; não-vazio; *"o que faz e quando usar"* | Não — é texto livre (mas é o que a busca indexa) |
| `license` | Não | nome ou referência a arquivo | **Sim** — enumerável na prática |
| `compatibility` | Não | ≤ 500 chars; ambiente/pacotes/rede | Parcial — texto livre |
| `metadata` | Não | mapa arbitrário | Não — arbitrário por definição |
| `allowed-tools` | Não | string separada por espaço (experimental) | **Sim** — enumerável |

**A descoberta que reorganiza a pergunta: o formato canônico não tem `tags`, não tem `category`, não
tem `status`.** As facetas que as referências visuais mostram **não vêm da skill** — são metadados
do **registro**.

O peer confirma essa separação por construção:
`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/types/skill.ts:64-105` define
`tags`, `visibility`, `is_enabled`, `status`, `num_stars`, `owner`, `registry_name` — nenhum deles
está na spec. São campos do registro dele.

**Consequência para nós:** faceta é decisão do **nosso** registro, não do formato. E nós já
decidimos parte dela: o M23 entregou `category` e `execution`; o M14, `visibility`. Estamos no mesmo
lugar que o peer, por caminho próprio.

---

## Coverage Corner 3 — Tools

### Q6 — que ferramenta o peer usa para testar o catálogo? **Jest + Playwright + Testing Library. Nada a importar.**

`.claude/knowledge-base/references/mcp-gateway-registry/frontend/package.json` — `scripts.test` é
`jest`; devDependencies trazem `jest`, `ts-jest`, `jest-environment-jsdom`, `identity-obj-proxy`,
`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`,
`@playwright/test`.

| Ferramenta | Papel | Adotar? |
|---|---|---|
| Jest (+ `ts-jest`, `jest-environment-jsdom`) | runner de unidade | **Não** — o dashboard usa Vitest, que cobre o mesmo com menos configuração |
| `identity-obj-proxy` | stub de CSS modules no Jest | **Não** — artefato da escolha do Jest; o Vite resolve nativamente |
| `@testing-library/*` | consulta por papel/nome acessível | **já temos** — é a família que o dashboard usa |
| `@playwright/test` | e2e | **já temos** |

**Nada a importar — que é resposta, não vazio.** O peer testa o catálogo com exatamente a família
que já usamos; a única diferença é o runner, e trocá-lo seria regressão de conveniência.

---

## Coverage Corner 4 — Techniques

### Q1 — card e linha coexistem. Qual vence, e quem escolhe? **Card para descobrir, linha para percorrer — e quem escolhe é o produto.**

`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/components/DiscoverTab.tsx`
mantém as duas formas e as usa em **momentos diferentes da mesma jornada**:

- **Destaque (card):** linha 19-20 define `const MAX_FEATURED = 4` — *"Maximum featured items per
  category"*. As linhas 238, 319 e 321 montam as listas de destaque com
  `_sortCustomByRating(filtered).slice(0, MAX_FEATURED)` e `_sortServersByRating(...)`. Isto é: a
  entrada da descoberta mostra **4 itens por categoria, ordenados por avaliação**.
- **Percurso (linha):** `DiscoverListRow.tsx` (362 linhas) é usado para a listagem completa por tipo
  — importado em `DiscoverTab.tsx:5`.

**Quem escolhe:** buscamos `viewMode|listView|gridView|isList|layout` em `DiscoverTab.tsx` — **nenhuma
ocorrência**. Não há alternador de visualização para o usuário. **O produto decide** pela função do
momento: card quando o objetivo é *reconhecer*, linha quando o objetivo é *percorrer*.

**Trade-off honesto:** essa escolha custa flexibilidade — quem já sabe o que quer e prefere densidade
não tem como pedir a lista na tela de destaque. O peer aceitou esse custo. Para nós, a mesma decisão
é ainda mais barata de aceitar: o M31 já entrega a tabela (T1.3), então card e linha existiriam em
telas diferentes, não competindo na mesma.

### Q2 — anatomia do card de skill: o que vira cada slot?

O modelo está em
`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/types/skill.ts:64-105`. O
mapeamento para os primitivos, e — coluna que decide tudo — se **nós** temos o dado:

| Slot | Primitivo do peer | Campo do peer | Nosso equivalente | Temos o dado? |
|---|---|---|---|---|
| Identidade | `CardHeader` | `name`, `author`, `version` | `name`, revisão vigente | **Sim** |
| Resumo | `CardBody` | `description` | `description` | **Sim** |
| Chips | `TagList` (`cards/TagList.tsx:27-69`) | `tags[]` | `category` (M23) | **Parcial** — temos categoria, não tags livres |
| Estatística | `CardStatsRow` (`cards/CardStatsRow.tsx:17-19`: *"star rating, tool count, version badge"*) | `num_stars`, contagem de ferramentas | — | **NÃO** — não medimos avaliação nem uso por skill |
| Estado | `StatusDot` | `status`, `health_status` | — | **NÃO** — só `ACTIVE`/`DELETED` |
| Habilitação | `ToggleSwitch` | `is_enabled` | — | **NÃO** |
| Segurança | escudo colorido | `security_scan.{critical,high,medium,low}` | secret scan no publish | **Parcial** — validamos, não persistimos resultado por skill |
| Ação destrutiva | `InlineDeleteConfirm` | — | `DELETE /v1/skills/:id` | **Sim** |
| Grade | `EntityGrid` (`entities/EntityGrid.tsx:20-31`) | — | — | n/a (layout) |

Detalhes de implementação que valem como decisão de design:

- **`TagList` mostra no máximo 3 chips e colapsa o resto em `+N`** (`TagList.tsx:9-10,40-41,58-66`),
  e devolve `null` quando não há tags — *"so callers don't need a guard"*. Chip nunca vira ruído.
- **`CardStatsRow` é uma grade de 1-3 colunas fixas** e o comentário diz a regra: *"Each child is one
  cell; **the card decides what goes in each**"* (`CardStatsRow.tsx:17-20`). O primitivo não sabe o
  que é métrica; ele só reserva o espaço.
- **`EntityGrid` usa `repeat(auto-fit, minmax(380px, 1fr))` com `gap: clamp(1.5rem, 3vw, 2.5rem)`**
  (`EntityGrid.tsx:24-27`), e o comentário registra por que existe: substituiu o mesmo estilo inline
  copiado em **~10 pontos de render**. Grade responsiva sem media query e sem dependência.

**O achado que atravessa o M31 e o M32:** o peer separa **`is_enabled: boolean`** de
**`status: 'active' | 'draft' | 'deprecated' | 'beta'`** (`types/skill.ts:73,95`) — duas dimensões
**ortogonais**. "Desligada" e "descontinuada" não são o mesmo estado, e o teste da linha 325
(`excludes disabled items from featured`) mostra a consequência funcional: **o desabilitado sai do
destaque**, sem deixar de existir. É prior art direta para a deprecação decidida para o M32.

### Q3 — de onde vem o número? **Filtro derivado no cliente; e o peer não exibe contagem por faceta.**

**No `mcp-gateway-registry`:** o filtro por tag desce como prop e é derivado no cliente.
`pages/Dashboard.tsx:211,214` declara `selectedTags?: string[]`; a linha 885-889 define o
predicado (`selectedTags.every(st => lowerTags.includes(st.toLowerCase()))`); e cada coleção o aplica
em `useMemo` — servidores (975-989), servidores externos (991-1003), agentes (1005-1017) e **skills**
(1019-1024). A linha 891 comenta *"Per-type custom entity counts for the sidebar summary"*: existe
contagem, mas **por tipo de entidade**, para o resumo lateral — **não por tag**.

**Não há chip de tag com número.** A faceta filtra; ela não se anuncia com uma contagem.

**No `mcp-context-forge`:** a superfície é server-rendered. `mcpgateway/templates/` tem
`mcp_registry_partial.html` (o catálogo) e `metrics_top_performers_partial.html` — o único lugar em
qualquer peer onde algo é **ranqueado por métrica**. Não abri o conteúdo para determinar se a métrica
é de uso ou de desempenho; o checkpoint EC-5 do plano exigia essa confirmação antes de usá-lo como
evidência de sinal de adoção, e ela não foi feita. **Registro como não verificado** em vez de
afirmar — a diferença entre "top performers = adoção" e "top performers = latência" muda a conclusão
inteira.

**A resposta honesta sobre sinal de adoção:** o único sinal que o peer de fato exibe e ordena é
**avaliação humana** (`num_stars`, `rating_details` — `types/skill.ts:84-85`; ordenação em
`DiscoverTab.tsx:238,319,321`; teste em `DiscoverTab.test.tsx:297`). Não são downloads. **Nós não
medimos avaliação por skill, e não medimos carregamento por skill** — o M21 entregou adoção por
*bundle*, que é outra granularidade. Pela regra D4 do plano e pelo `rules/public-copy.md` § 5, um
card nosso **não pode** exibir estrelas nem downloads hoje.

---

## ADRs

### D1 — Card e tabela convivem, separados por jornada; o produto escolhe, não o usuário

**Decisão:** a superfície de catálogo (grade de cards) atende *reconhecer*; a `DataTable` do M31
atende *percorrer e agir*. Nenhum alternador de visualização.

**Alternativas consideradas:**

1. **Só tabela** (o que o M31 entrega hoje). Rejeitada: uma tabela responde "qual destes?" mal para
   quem não sabe o que existe — é densa em texto e pobre em reconhecimento.
2. **Só cards.** Rejeitada: cards perdem para tabela quando o objetivo é comparar e agir em lote, e
   o `DESIGN.md` § 10 é explícito em "tabelas para decisão".
3. **Alternador grade/lista para o usuário.** Rejeitada com evidência: o peer, que tem as duas
   formas, **não** oferece alternador (`viewMode|listView|gridView` → zero ocorrências em
   `DiscoverTab.tsx`). Adicionar um seletor é estado a manter, testar e explicar, para resolver um
   problema que o peer não teve.

**Consequences:** duas telas com propósitos declarados, e a obrigação de dizer em cada uma qual é o
seu. Custo aceito: quem prefere densidade não a tem na tela de descoberta.

### D2 — Faceta é metadado do registro, nunca do formato

**Decisão:** as facetas do catálogo saem de campos que **nós** controlamos (`category`, `execution`,
`visibility`, `embedded`), não do frontmatter do `SKILL.md`.

**Rationale:** a spec canônica define seis campos e nenhum é uma taxonomia
(`specification.mdx:25-32`). O peer chegou à mesma conclusão por construção: `tags`, `status` e
`visibility` vivem no tipo do **registro** dele (`types/skill.ts`), não na skill.

**Alternativas consideradas:**

1. **Ler `tags` do frontmatter.** Rejeitada: não existe no formato; inventá-lo criaria divergência
   com a spec que o Theokit segue, e o campo `metadata` (arbitrário) não é facetável por definição.
2. **Derivar tags da `description` por NLP.** Rejeitada: taxonomia inferida é taxonomia instável — a
   mesma skill mudaria de gaveta a cada reindexação, e o usuário não teria como corrigir.

**Consequences:** a faceta é nossa responsabilidade e nossa dívida. Se quisermos tags livres além de
`category`, isso é campo novo no registro — trabalho de milestone, não de tela.

### D3 — Nenhuma métrica de adoção no card enquanto não houver agregação entre bundles

> **Premissa corrigida em 2026-08-04** pelo blueprint `m35-bundles-adoption-surface`. A versão
> original deste ADR dizia *"nós não medimos carregamento por skill; o M21 mede adoção por bundle,
> granularidade errada"*. **Isso é falso** — `adoption-store.ts:7-19` registra `InstallEvent` com
> `skillId` e devolve `AdoptionRow{skillId, version, installs}`. A medição **é** por skill.
>
> A conclusão do ADR permanece válida, por outro motivo: **não existe agregação entre bundles**. Uma
> skill distribuída em três bundles produz três linhas independentes, e "instalações totais da skill
> X" não é computável. Exibir a contagem de um bundle como se fosse da skill continua sendo mentira
> — mas por particionamento, não por granularidade.

### D3 (texto original, premissa incorreta) — Nenhuma métrica de adoção no card enquanto não medirmos por skill

**Decisão:** o card exibe `category`, `execution`, `visibility` e `embedded`. **Não** exibe estrelas,
downloads nem "populares".

**Rationale:** o único sinal que o peer exibe é avaliação humana, e nós não a coletamos; o M21 mede
adoção por **bundle**, não por skill. `rules/public-copy.md` § 5 proíbe número não medido, e a
auditoria de 2026-08-04 já registrou o custo concreto de um número que mente ("10 operational"
enquanto a tela ao lado diz inalcançável).

**Alternativas consideradas:**

1. **Exibir downloads derivados da adoção de bundle.** Rejeitada: granularidade errada — uma skill
   dentro de um bundle muito baixado apareceria popular sem ninguém tê-la usado.
2. **Exibir "recém-publicada" como proxy de relevância.** Rejeitada: recência não é adoção, e
   ordenar por ela premiaria quem publica mais, não o que serve.
3. **Coletar avaliação humana agora.** Rejeitada por YAGNI: exige identidade, moderação e massa
   crítica que um registro interno não tem.

**Consequences:** o `CardStatsRow` do nosso card nasce com os slots que **temos**, e o mais valioso
deles é `embedded` — *achável ou não*, que é uma pergunta real do operador e um dado que já medimos
(entregue no eixo de API do M31). Quando houver carregamento por skill, o slot existe para recebê-lo.

### D4 — Chip de tag sem contagem, com teto de 3 e `+N`

**Decisão:** chips filtram e não exibem número. Máximo 3 visíveis, excedente em `+N`.

**Rationale:** a contagem por faceta é o elemento das referências visuais que **nenhum peer clonado
tem** — o `Dashboard.tsx` filtra por tag sem exibir contagem, e não há teste de contagem em lugar
nenhum (Q3, Q7). Um número na tela é uma afirmação: exigiria decidir se conta o acervo inteiro ou a
página, e provar contagem↔conteúdo com teste próprio. O teto de 3 + `+N` vem do peer
(`TagList.tsx:9-10,58-66`) e resolve o ruído sem prometer nada.

**Alternativas consideradas:**

1. **Chips contados, como nas referências visuais.** Não rejeitada em definitivo — **adiada** por
   falta de lastro: quando a contagem vier do servidor junto da listagem, ela passa a ser medida e o
   chip pode exibi-la. Hoje seria derivada da página carregada e mentiria sobre o acervo.
2. **Sem teto de chips.** Rejeitada: uma skill com 12 tags dominaria o card e a grade perderia o
   alinhamento que o `EntityGrid` mantém.

**Consequences:** nosso catálogo sai visualmente mais sóbrio que as referências. É deliberado, e a
diferença é exatamente um número que ainda não podemos provar.

---

## Cross-cutting Comparison

### O que NÃO adotar, e por quê

| Do peer / das referências | Por que não |
|---|---|
| **Contagem por faceta nos chips** | Nenhum peer clonado tem; hoje só seria derivável da página carregada, e um número derivado de amostra parcial afirma sobre o acervo o que não sabe (D4) |
| **`num_stars` / avaliação humana** | Não coletamos, e coletar exige identidade + moderação + massa crítica (D3) |
| **Downloads no card** | Medimos adoção por bundle (M21), não por skill — granularidade errada leva a card popular sem uso (D3) |
| **Alternador grade/lista** | O peer, tendo as duas formas, não o oferece; é estado a mais sem problema demonstrado (D1) |
| **Jest + `identity-obj-proxy`** | Trocaria Vitest por configuração adicional para a mesma capacidade (Q6) |
| **`clsx`, `@headlessui/react`, `@heroicons/react`, `axios`, `date-fns`** | Todas resolvidas por `@usetheo/ui` / `lucide-react` / `cloudFetch` (Q4, `parsimony-ladder` rung 4) |
| **`tags` no frontmatter do `SKILL.md`** | Não existe na spec canônica; inventar divergiria do formato que o Theokit segue (D2) |
| **Filtro por "plataforma"** (das referências visuais) | Pressupõe múltiplas plataformas de destino; nosso registro tem uma. Faceta importada seria coluna sempre igual |

## Recommendations

Em ordem de dependência.

| # | Recomendação | Onde | Evidência |
|---|---|---|---|
| R1 | **Terceiro estado vazio: "busca sem resultado"**, distinto de acervo-vazio e de leitura-falhou | `theo-cloud/dashboard` | Q8 — `DiscoverTab.test.tsx:166` vs `:173`; hoje temos só dois estados |
| R2 | **Grade de cards para descobrir**, mantendo a tabela do M31 para percorrer e agir | `theo-cloud/dashboard` | D1; `MAX_FEATURED=4` + ausência de alternador no peer |
| R3 | **Card com os slots que temos:** nome, descrição, `category`, `execution`, `visibility` e **`embedded`** | `theo-cloud/dashboard` | Q2 (mapa de slots) + D3; `embedded` já entregue no eixo de API do M31 |
| R4 | **Chips de `category` com teto 3 + `+N`, sem contagem** | `theo-cloud/dashboard` | D4; `TagList.tsx:9-10,58-66` |
| R5 | **Ordenação determinística com desempate** por identificador ao ordenar o catálogo | `theo-cloud/dashboard` | Q1 — `DiscoverTab.test.tsx:297` testa exatamente isso; nosso `rrfFuse` já desempata por `skill_id` |
| R6 | **Grade responsiva sem dependência** — `auto-fit` + `minmax` + `clamp`, escrita por nós | `theo-cloud/dashboard` | `EntityGrid.tsx:24-27`; Q4 (zero deps novas) |
| R7 | **Levar `is_enabled` × `status` para o M32** como dimensões ortogonais, não um enum só | `theo-skills` (domínio) | Q2 — `types/skill.ts:73,95`; `DiscoverTab.test.tsx:325` prova a consequência funcional |

**R7 não é escopo do M31** e está aqui porque a evidência apareceu nesta descoberta: quando o M32
desenhar deprecação, ele já tem prior art de que "desligada" e "descontinuada" são coisas diferentes,
e de que a primeira deve remover do destaque sem remover do acervo.

## Limites desta descoberta

- **Não confirmei o que `metrics_top_performers_partial.html` ranqueia.** O checkpoint EC-5 do plano
  exigia determinar se a métrica é de uso ou de desempenho antes de tratá-la como sinal de adoção.
  Não foi feito. A conclusão de D3 **não depende** disso (ela se apoia no que *nós* medimos), mas
  qualquer afirmação futura sobre "como os peers exibem adoção" precisa fechar esta pendência.
- **Não li `SkillCard.tsx` por completo.** Conforme D2 do plano (terceira classe), o mapa de slots
  veio do modelo de dados (`types/skill.ts`, lido inteiro) e dos primitivos de `cards/` (lidos
  inteiros). As 887 linhas do `SkillCard` não foram abertas — se houver slot que o modelo não
  revela, ele não está aqui.
- **Não medi acessibilidade nem desempenho da grade** sob acervo grande. A afirmação de que
  `auto-fit`/`minmax` basta é estrutural (é CSS puro, sem JS), não medida com 250 cards.
- **Nenhuma linha de código dos peers atravessou** (D3 do plano). O que veio foi decisão de design
  com citação. Os dois registries são Apache-2.0 e ainda assim nada foi copiado.
- **As duas referências visuais fornecidas não foram tratadas como fonte de verdade** — são
  produtos de terceiros vistos por captura de tela, sem acesso ao código ou ao dado por trás. O que
  elas fizeram foi levantar a pergunta; quem respondeu foram os peers clonados e o nosso domínio.
