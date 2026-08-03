---
date: 2026-08-03
tipo: auditoria de UX + desenho de jornadas
alvo_das_telas: theo-cloud/dashboard
contrato: theo-cloud/dashboard/DESIGN.md v1.0 (locked)
metodo: navegação real em app-dev.usetheo.dev (clique a partir da raiz) + leitura de código
---

# Skills — auditoria de UX e desenho das jornadas

## Como isto foi medido

Naveguei o `app-dev` **clicando a partir da raiz**, nunca digitando URL — a regra que o
`CLAUDE.md` deste repo diz ter custado quatro telas inalcançáveis no `theo-trust`. Percurso:
Overview → menu Skills → lista → detalhe de `redteam-cambio-1785615135` → versões e canais.
Depois li o código das telas, do BFF e do `DESIGN.md`.

Tudo abaixo é observação, não impressão. Onde eu não medi, digo.

## O gap, em um número

| | endpoints de skills na API | com superfície de tela |
|---|---|---|
| Leitura | 10 | 5 |
| **Escrita** | **7** | **1** — promover canal |

E na navegação:

| Capacidade | Itens de submenu |
|---|---|
| Observability | 14 (3 grupos) |
| Memory | 9 |
| Trust | 4 |
| Prompts | 2 |
| **Skills** | **1** |

O comentário no `app-sidebar-menus.ts` justifica o item único: detalhe e versões são POR SKILL,
alcançadas da lista, e inventar entradas de menu para elas levaria a lugar nenhum. **Isso está
certo.** O que ele não cobre é que Memory tem `Playground`, Prompts tem `Nova revisão` e Trust
tem `Guardrails` — todas ações **de workspace**, que cabem no menu. Skills não tem nenhuma.

## O que a navegação real mostrou

**A `<main>` de `/skills` não tem um único botão.** Verificado na árvore de acessibilidade: só
heading, texto e links de linha da tabela. O `DESIGN.md` §1 pede que toda tela responda em ≤3s
"qual é a ação principal?" e "o que eu faço agora?". Esta tela não responde nenhuma das duas.

**A jornada termina num beco.** Detalhe → "Ver versões e canais" → *0 versões*, sem ação, com o
texto "Publique uma versão pela CLI". Fim. O último passo da única jornada existente aponta para
fora do produto, sem comando copiável e sem CTA.

**O acervo tem lixo que a tela não deixa limpar.** A skill `m26-verify-clique` se descreve como
*"Skill DE TESTE criada para verificar a promoção de canal pela tela (M26). **Pode ser
removida**"* — e não há como removê-la de tela alguma. `DELETE /v1/skills/:id` existe na API há
milestones.

## Violações do DESIGN.md, com evidência

| § | Regra | Onde | Evidência |
|---|---|---|---|
| 4.1 | "Toda tela precisa de ao menos um próximo passo acionável" | `/skills` | zero botões na `main` |
| 5.1 | `EmptyState` = ícone + título + descrição + **CTA** | `/skills`, `/skills/:id/versions` | os dois sem `cta`; o de versões manda usar a CLI sem comando copiável |
| 1 (Q1) | "breadcrumb quando aninhado" | `/skills/:id`, `.../versions` | rotas aninhadas sem breadcrumb; a volta é o item de menu, que leva ao overview e não à origem |
| 10.2 | busca quando N>10; retry no erro; paginação | `/skills` | nenhum dos três. `next_page_token` está **tipado e não usado** — acima de 100 skills somem em silêncio |
| 11.1 | `CopyButton` com estados | detalhe | a "Instrução resolvida" é o texto que o agente carrega, num `<pre>` sem copiar |
| 6.1 | erro = título + causa + **impacto** + **ação** + CTA | `/skills` | o `Alert` tem título e causa; não tem ação nem Retry |

Três coisas que o código faz **certo** e devem ser preservadas: distingue "falhou a leitura" de
"não há nada" (a lição que o `theo-trust` pagou caro), diz `local`/`remote` com texto e não só
cor, e marca `origin: public` como *"publicada por terceiro"* — porque é instrução de terceiro
que o agente vai seguir.

## As três pessoas, e as jornadas que faltam

### 1. Quem autora — hoje não existe

Só CLI. A API do M30 já entrega o que a tela precisa: `POST /v1/skills:validate` valida **sem
publicar**, `POST /v1/skills` aceita `SKILL.md` avulso (sem ZIP), e o erro traz `field` e `line`
como dados. Hoje o único jeito de descobrir que o frontmatter está errado é publicar e ver a
operação falhar.

```
/skills/new
  editor (frontmatter + corpo)  ──live──>  painel de validação
                                            erro com field/line, cursor posicionável
  [Publicar]  ──>  operação (GET /v1/operations/:id)  ──>  sucesso
                                                            [Testar descoberta]
```

O CTA de sucesso **não** é "voltar à lista": é *testar se um agente acha esta skill*. Publicar
sem saber se é descobrível é o mesmo problema de antes, uma camada acima.

### 2. Quem opera — existe pela metade

Navega e promove canal. Não remove, não edita, não controla visibilidade, não vê proveniência.

Faltam, todos com API pronta: `DELETE /v1/skills/:id`, `PATCH`, `PUT .../visibility`,
`DELETE .../channels/:channel`, `GET .../provenance`.

Excluir e despromover canal são destrutivos e o `DESIGN.md` §16 já prescreve a coreografia:
`DangerZone` + `ConfirmDialog` com frase digitada + declaração de reversibilidade. Para skills a
frase de impacto é específica e precisa ser escrita com honestidade:

> Promover `stable` para `rev_x` aponta **todos** os consumidores deste canal para outro
> conteúdo. Reversível promovendo a revisão anterior.

### 3. Quem depura descoberta — não existe, e é o maior buraco

**A razão de existir deste produto é um agente achar a skill certa por intenção.** Não há como
ver isso funcionando. `GET /v1/skills:retrieve` não tem superfície alguma.

Memory resolveu exatamente isto com o Playground — *"remember and recall live, no code
required"*. O equivalente aqui:

```
/skills/playground
  [consulta em linguagem natural]  [topK]
        ↓ GET /v1/skills:retrieve
  resultados com SCORE por linha
  + qual perna respondeu: léxica (FTS) ou vetorial
```

Essa última coluna não é enfeite. O roadmap do M4 registra que a recall é **carregada pelo
FTS** — a mesma avaliação com estratégia vetorial isolada dá **0.308**, porque o embedder padrão
é um hash determinístico. Um operador não tem como enxergar isso hoje. Um playground que mostra
a perna torna visível a diferença entre "achou porque as palavras batem" e "achou porque
entendeu" — que é a promessa que o produto vende.

### 4. Quem publica para terceiros — capacidade inteira sem tela

M20 entregou bundles + tokens delegados; M21, telemetria de adoção para o publisher. `GET
/v1/bundles`, `GET /v1/bundles/:id/adoption`, `POST /v1/bundles/:id/tokens`. **Zero telas.**
Quem publica não tem como responder "quem instalou minha skill?" a não ser por curl.

Não proponho resolver isto agora — registro porque uma capacidade entregue e invisível é
indistinguível de uma não entregue, e o roadmap a marca `[x]`.

## Arquitetura de informação proposta

Seguindo o padrão de Memory, que é o que você apontou:

```
SKILLS
├── Overview        /skills              métricas + acervo + grid Explore
├── Playground      /skills/playground   testar descoberta por intenção     ← novo
├── Nova skill      /skills/new          autorar com validação prévia       ← novo
└── Canais          /skills/channels     o que cada canal serve, no acervo  ← novo
```

Três itens novos, todos **ações de workspace** — que é o critério que o próprio comentário do
menu estabelece para o que entra e o que não entra. Detalhe e versões continuam por skill,
alcançados da lista.

**A linha que ninguém lembra:** `resolveActiveMenu` já tem `/skills` (verifiquei), então o
submenu abre. Qualquer rota nova precisa entrar em `app.tsx` **e** no submenu — declarar só a
rota entrega tela inalcançável, que foi o defeito do `theo-trust`.

## Overview, no padrão de Memory

Hoje: uma tabela. O de Memory tem 4 `MetricCard` + prévia + grid `Explore` com 6 cards.

Proposta de métricas — cada uma responde a uma pergunta que alguém de fato faz:

| Métrica | Pergunta que responde |
|---|---|
| Skills publicadas | quanto existe |
| **Descobríveis** (com embedding) | *quantas um agente consegue achar por intenção* |
| Canais ativos | quantos apontam para algo |
| Carregamentos (7d) | alguém usa isto? |

A segunda é a que importa e a que não existe: uma skill publicada **sem embedding** é invisível
à busca semântica e o painel não distingue. Precisa de contagem no BFF — anotado abaixo como
trabalho de backend.

Grid `Explore`: *Publicar uma skill* · *Testar descoberta* · *Canais e promoção* · *Distribuir
para terceiros* · *Documentação*.

## O que dá para construir com o BFF de hoje

O BFF (`internal/routes/skills_dashboard.go`) expõe List, Get, Versions, Channels, Instructions
e **um** write: `PUT .../channels/{channel}`. Então:

| Entrega | Precisa de backend? |
|---|---|
| CTA + `EmptyState` completo em `/skills` | não |
| Breadcrumb nas rotas aninhadas | não |
| `CopyButton` na instrução | não |
| Busca + paginação (`next_page_token`) na lista | não — o campo já vem |
| Retry no erro | não |
| Playground de descoberta | **sim** — proxy de `:retrieve` |
| Autoria (`new`) | **sim** — proxy de `:validate`, `POST`, `operations/:id` |
| Excluir / visibilidade | **sim** — proxy de `DELETE`, `PUT visibility` |
| Métrica "descobríveis" | **sim** — contagem nova |

As cinco primeiras são falhas de contrato do `DESIGN.md` em telas que já existem. As outras
exigem rota no BFF antes de qualquer pixel.

## Sequência sugerida

1. **Fechar o contrato nas telas existentes** — CTA, breadcrumb, copiar, busca, paginação,
   retry. Sem backend, e tira `/skills` da condição de "dead page".
2. **Playground de descoberta.** Maior valor por esforço: torna visível a promessa central do
   produto e expõe o desequilíbrio FTS × vetorial que hoje só aparece num relatório de eval.
3. **Autoria com validação prévia.** A API do M30 foi feita para isto e não tem consumidor.
4. **Excluir + visibilidade**, com a coreografia do §16.
5. **Bundles e adoção** — capacidade inteira sem superfície; merece plano próprio.

## O que este repositório decide

As telas nascem em `theo-cloud/dashboard`, nunca aqui. O que cabe ao `theo-skills` é o que a API
torna possível — e há dois pontos onde ela hoje limita a UX:

- **`GET /v1/skills` não devolve se a skill tem embedding.** Sem isso a métrica "descobríveis"
  não existe, e o operador não distingue publicada de achável.
- **`:retrieve` não diz qual perna casou.** Sem isso o playground mostra um score sem explicar
  de onde ele veio — e a diferença entre léxico e semântico é justamente o que se quer ver.

Os dois são mudanças de contrato de leitura, aditivas, sem quebrar consumidor.

## Limite honesto desta auditoria

Naveguei com **3 skills de teste** num workspace. Não vi a tela sob carga (100+ skills, onde a
paginação silenciosa morde), não testei teclado nem leitor de tela (o §12.2 exige), não medi em
320px (o §13.2 exige 8 larguras) e não exercitei o caminho `local` → `422` no detalhe. Cada um
desses é uma verificação a fazer, não uma que eu esteja reportando como feita.
