---
date: 2026-08-04
tipo: comparação de padrão medida em navegação real
alvo_das_telas: theo-cloud/dashboard
método: clique a partir da raiz no app-dev; árvore de acessibilidade, não screenshot
complementa: 2026-08-03-skills-ux-journeys.md
---

# Skills × Memory — o padrão, medido nas telas

A auditoria de ontem leu o **código** do `memory.tsx`. Esta navegou as telas. A diferença
importa: o código diz o que foi escrito, a árvore de acessibilidade diz o que o usuário encontra.

Percurso: raiz → Memory → Overview, Playground, Memories. Depois raiz → Skills → Overview.

## O contraste em um número

Contando elementos acionáveis na `<main>` (botões e CTAs, excluindo navegação e links de linha):

| Tela | Acionáveis | Quais |
|---|---:|---|
| **Memory / Overview** | **8** | `Refresh`, `Browse memories →`, e 6 × `Open →` do grid Explore |
| **Memory / Playground** | **3** | `Remember`, `Recall`, `Run reflection` |
| **Memory / Memories** | **4** | filtros: Scope, Category, From, To |
| **Skills / Overview** | **0** | — |

O Memory Overview estava **em erro** durante a medição (*"Could not load memory metrics"*) e
mesmo assim oferecia 8 caminhos. O Skills Overview estava **saudável**, com 3 skills carregadas,
e oferecia zero.

Isso responde o §1 do `DESIGN.md` de forma direta: *"qual é a ação principal?"* e *"o que eu faço
agora?"* — a tela de Skills não responde nenhuma das duas, em nenhum estado.

## O que o Memory faz, concretamente, que dá para copiar

### 1. O erro tem ação

```
Could not load memory metrics
The Memory service is not reachable right now. Try refreshing in a moment.
[ Refresh ]
```

Título, causa, o que fazer, e um botão que faz. O `Alert` do Skills tem título e causa, e **para
aí** — sem `Retry`. O `DESIGN.md` §6.1 pede seis elementos; o de Memory entrega quatro, o de
Skills dois.

### 2. "Getting started" com código copiável e um CTA in-app

```
Use the SDK to remember facts from your agent. Anything you write here is
queryable via  theo.memory.user('u').recall()
[ Browse memories → ]
```

O CTA aponta **para dentro** do produto, não para a documentação. O `EmptyState` de Skills diz
*"Publique uma skill pela CLI"* — sem comando copiável e sem botão, apontando para fora.

### 3. Grid `Explore` — seis portas, cada uma com verbo

Cada card é `heading` + uma frase do que é + `Open →`. As frases dizem **benefício**, não feature:

- *"Remember and recall live, no code required."*
- *"See how the entities your agent remembers relate to each other."*

### 4. O Playground é a capacidade, exercitável

Três seções `h2`, uma por **verbo** do produto — `Remember`, `Recall`, `Reflect`. Detalhes que
não aparecem no código lido de fora e que são o que faz a tela funcionar:

| Padrão observado | Por que importa |
|---|---|
| Botão **desabilitado até o input ser válido** (`Remember`, `Recall` vêm `disabled`) | não existe submit morto; o estado do botão **é** a validação |
| Campos opcionais rotulados `(optional)` no próprio label | o usuário sabe o que pode pular sem ler doc |
| `description` associada ao input | *"Attributed to: when set, the fact is stored verbatim as that peer's statement (skips auto fact-extraction)"* — semântica no ponto de uso, e satisfaz o `aria-describedby` do §12 |
| Disclosure progressiva | o seletor `hops` só habilita com o checkbox `Graph expand` marcado |
| A seção explica o que a ação **realmente** faz | *"Runs the same pipeline the agent triggers automatically"* — conecta o botão ao comportamento real do sistema, em vez de vender um brinquedo |

Essa última linha é o padrão mais valioso e o mais fácil de perder: o Playground **não** é uma
demo paralela; é a mesma pipeline. Dizer isso é o que o torna confiável.

### 5. Listagem com filtros, não só linhas

`Memories` traz Scope, Category, From, To **acima** da tabela — e os mantém visíveis mesmo no
estado de erro. A tabela de Skills não tem busca nem filtro, e o `next_page_token` continua
tipado e não usado: acima de 100 skills, o excedente some sem erro.

## O Playground de Skills, derivado do padrão

O Memory exercita seus três verbos. Os do Skills são outros, e o M31 acabou de entregar o dado
que faltava para o primeiro:

| Seção | Entrada | Saída | Já existe na API? |
|---|---|---|---|
| **Descobrir** | consulta em linguagem natural, `topK`, estratégia | resultados com score **e qual perna casou** — `matched` | **sim**, entregue no `0.3.0` |
| **Validar** | `SKILL.md` colado | erro tipado com `field` e `line`, sem publicar nada | **sim**, `POST /v1/skills:validate` (M30) |
| **Carregar** | uma skill escolhida | a instrução que o agente receberia, com `origin` | **sim**, `GET .../instructions` |

Os três verbos têm rota pronta e **nenhuma tela**. O `:validate` do M30 e o `matched` do M31
foram construídos e não têm consumidor.

Aplicando o padrão observado:

- O botão **Descobrir** nasce desabilitado até haver consulta.
- A perna que casou aparece como **texto**, nunca só cor — o `DESIGN.md` §12 exige, e a própria
  tela de Skills já acerta isso com `LOCAL`/`REMOTE`.
- O score bruto do RRF (`≈0,016–0,033`) é ilegível: reescalar para 0-100 na tela, mantendo o
  bruto no contrato — decisão já registrada como D2 no blueprint do M31.
- A seção **Descobrir** diz, como o Reflect do Memory diz: *"é a mesma busca que o agente usa"*.
  Se não for a mesma, não se escreve isso.

## Achado colateral, e ele é de honestidade

O rodapé de toda tela diz **"10 operational, 0 unreachable"**. Ao mesmo tempo, duas telas de
Memory mostravam *"The Memory service is not reachable right now"*.

As duas checagens não perguntam a mesma coisa — o `/status` sonda o serviço direto, o BFF passa
por outro caminho e outra credencial. Mas quem lê o rodapé não sabe disso: para o operador, o
sistema afirma "operacional" enquanto a tela à frente dele diz "inalcançável". **Uma das duas
está mentindo para quem olha**, e a que mente é a que ele vê primeiro em toda tela.

Registrado aqui como observação; não investiguei a causa, e não vou afirmar qual das duas está
errada sem medir.

## O que isto muda no M31

Nada do que foi entregue no `0.3.0` muda. O que esta navegação acrescenta é **especificação de
tela derivada de padrão medido**, não inventada: o plano 2 do M31 (as telas, no `theo-cloud`)
passa a ter um alvo concreto — reproduzir os cinco padrões acima, não "fazer parecido com o
Memory".
