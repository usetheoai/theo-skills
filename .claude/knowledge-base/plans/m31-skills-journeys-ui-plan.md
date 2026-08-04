---
slug: m31-skills-journeys-ui
target_project: theo-cloud
milestone_id: M31
created_at: 2026-08-03
goal: Fechar o eixo de tela do M31 — criar, validar, descobrir, editar e excluir uma skill inteiramente pelo painel.
---

# Plan: M31 — as jornadas de skills no painel (eixo de tela)

> **Version 1.0** — O M31 tem seis critérios de Definition of done. Os **dois de API** já foram
> entregues e aceitos (`0.3.0` / tag `v0.12.0`, verdict `ACCEPTED_WITH_CAVEATS`): `GET /v1/skills`
> devolve `visibility` e `embedded`, e `:retrieve` devolve `matched` — qual perna casou. Os
> **quatro restantes são de tela** e nenhum tem superfície: quem autora só tem CLI, quem opera não
> remove nem edita, quem depura descoberta não tem por onde, e a lista perde skills em silêncio
> acima de 100. Este plano entrega essas quatro jornadas no `theo-cloud/dashboard` sob o contrato
> do `DESIGN.md`, e termina com a jornada inteira exercitada por clique a partir da raiz.

## Goal

> Enable o autor e o operador de skills a criar, validar, descobrir, editar e excluir uma skill
> **inteiramente pelo painel, sem CLI**, medido por `../theo-cloud/dashboard/e2e/skills-journey.spec.ts`
> cobrindo a jornada completa por clique a partir da raiz e passando.

## Context

O M31 nasceu de uma auditoria medida — não de impressão. Em 2026-08-03 o `app-dev` foi navegado
**por clique a partir da raiz**, lendo a árvore de acessibilidade, e o resultado está em
`.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md`: a `<main>` de `/skills` não tem
**um único botão**, a única jornada existente termina em *0 versões → "publique pela CLI"* sem
comando copiável, e **1 de 7 escritas** da API tem superfície de tela.

A comparação com o Memory, medida no dia seguinte
(`.claude/knowledge-base/audits/2026-08-04-skills-vs-memory-padrao-medido.md`), quantificou o
contraste: Memory/Overview oferecia **8 elementos acionáveis mesmo estando em erro**;
Skills/Overview oferecia **zero estando saudável**.

O eixo de API do M31 já fechou a lacuna de dados: o `matched` existe hoje no contrato
(`packages/core/src/domain/retrievers/types.ts:62`) e é contado no handler
(`packages/api/src/server/handlers/retrieve.ts:95-96`). O `POST /v1/skills:validate` do M30 valida
sem publicar e devolve `field`/`line`. **Os dois foram construídos e não têm consumidor** — este
plano é o consumidor.

O acervo de dev, lido na aceitação, mostra o custo de não ter a tela: 2 das 3 skills estão
publicadas e **invisíveis à busca semântica** (`embedded: false`), e uma delas se descreve como
*"pode ser removida"* sem que exista onde removê-la.

## Baseline Context (deep review of current state)

> **Nota de caminho, deliberada.** O `CLAUDE.md` deste repositório proíbe frontend aqui — as telas
> nascem em `theo-cloud/dashboard`. Os artefatos deste ciclo (plano, review, acceptance) e o
> CHANGELOG ficam **neste** projeto, por `rules/knowledge-base-location.md`. Os caminhos de código
> abaixo usam o prefixo `../theo-cloud/`, que **resolve de fato** a partir da raiz deste repo
> (verificado por `ls`).

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `../theo-cloud/internal/routes/skills_dashboard.go` | 274 | `172219d` (2026-08-02) | BFF de skills — 5 leituras + 1 escrita (promoção) | `writeRejection` preserva o texto tipado do upstream; leitura e escrita usam clientes com credenciais distintas |
| `../theo-cloud/internal/skills/data_client.go` | 138 | `de43ede` (2026-08-02) | Cliente de leitura do registry (escopo `skills:read`) | Não pode ganhar capacidade de escrita — a separação é o controle |
| `../theo-cloud/internal/skills/write_client.go` | 98 | `37aa36f` (2026-08-02) | Cliente de escrita (escopo `skills:publish`) | Erro do upstream chega preservado (`upstream_error.go`) |
| `../theo-cloud/dashboard/src/components/skills/skills-api.ts` | 76 | `37aa36f` (2026-08-02) | Único ponto por onde as telas falam com o BFF | `throwOnError: true` em toda chamada — sem isso erro vira lista vazia |
| `../theo-cloud/dashboard/src/pages/skills.tsx` | 153 | `767d001` (2026-08-02) | Overview: tabela do acervo | Distinguir "falhou a leitura" de "não há nada"; `execution` como texto, não só cor |
| `../theo-cloud/dashboard/src/pages/skills/detail.tsx` | 156 | `767d001` (2026-08-02) | Detalhe de uma skill | `origin: public` continua marcado como "publicada por terceiro" |
| `../theo-cloud/dashboard/src/pages/skills/versions.tsx` | 241 | `aa8944c` (2026-08-02) | Versões e canais + promoção | A promoção existente não pode regredir |
| `../theo-cloud/dashboard/src/pages/skills/playground.tsx` (NEW) | 0 | — | (a criar) | — |
| `../theo-cloud/dashboard/src/pages/skills/create.tsx` (NEW) | 0 | — | (a criar) | — |
| `../theo-cloud/dashboard/src/components/skills/retrieve-projection.ts` (NEW) | 0 | — | (a criar — lógica pura de reescala e rótulo de perna) | — |
| `../theo-cloud/dashboard/src/components/skills/skill-draft.ts` (NEW) | 0 | — | (a criar — validação cliente do frontmatter) | — |
| `../theo-cloud/dashboard/src/components/layout/app-sidebar-menus.ts` | 415 | `48dee2a` (2026-08-03) | Navegação — 3 peças por capacidade | `resolveActiveMenu` já trata `/skills`; novas rotas precisam entrar no submenu |
| `../theo-cloud/dashboard/src/app.tsx` | 693 | `1daeb46` (2026-08-03) | Rotas + lazy imports | Rota declarada sem item de menu = tela inalcançável |
| `../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts` | 143 | `37aa36f` (2026-08-02) | Mocks MSW — sem eles a tela não entra no e2e hermético | Todo endpoint novo precisa de handler |
| `../theo-cloud/dashboard/e2e/skills-journey.spec.ts` | 178 | `c87a87a` (2026-08-02) | Jornada e2e de skills | Navegação por clique, nunca por URL digitada |

Arquivos de teste unitário acompanham cada `.tsx`/`.ts` novo pela convenção do repo
(`<name>.test.tsx` ao lado), e `skills_dashboard_test.go` acompanha o handler Go.

### Current callers / dependents

- **Símbolo:** `fetchSkills` / `fetchSkill` / `fetchSkillVersions` / `fetchSkillChannels` /
  `fetchSkillInstructions` / `promoteChannel` em `../theo-cloud/dashboard/src/components/skills/skills-api.ts`
- **Callers (produção):** `pages/skills.tsx:17`, `pages/skills/detail.tsx`, `pages/skills/versions.tsx`
- **Callers (testes):** `pages/skills.test.tsx`, `pages/skills/*.test.tsx`, `lib/mocks/skills-handlers.ts`
- **Externo (consumido por outro repo):** não — é camada de tela.

- **Símbolo:** `MountSkillsDashboard` / `MountSkillsPromotion` em `../theo-cloud/internal/routes/skills_dashboard.go:182,269`
- **Callers (produção):** composição do servidor cloud (wiring)
- **Callers (testes):** `../theo-cloud/internal/routes/skills_dashboard_test.go`
- **Externo:** não — o BFF é interno; o contrato público é o do registry.

- **Símbolo:** `matched` / `MatchedLeg` em `packages/core/src/domain/retrievers/types.ts:62,68`
- **Callers (produção):** `packages/core/src/domain/retrievers/hybrid-retriever.ts:62,77,101,111`;
  `packages/api/src/server/handlers/retrieve.ts:95-96`
- **Externo (contrato público consumido por outros repos):** **sim** — é a resposta de
  `GET /v1/skills:retrieve`, consumida por SDK, MCP e agora pelo dashboard. Mudanças aqui são
  aditivas por contrato; este plano **consome**, não altera.

### Domain glossary

- **perna (leg)** — cada um dos dois retrievers da busca híbrida: `keyword` (FTS do Postgres) e
  `vector` (pgvector). O `matched` diz em quais a skill apareceu e em que rank.
- **RRF** — Reciprocal Rank Fusion: funde as duas listas por posição, não por magnitude. Score bruto
  na casa de `1/(60+rank)` ≈ 0,016–0,033.
- **embedded** — a revisão vigente tem embedding. Publicada sem embedding = invisível à perna vetorial.
- **revisão** — unidade imutável de conteúdo de uma skill. Canal aponta para uma revisão.
- **canal** — rótulo móvel (`stable`, `beta`) que os consumidores seguem.
- **LRO** — Long-Running Operation: publicar devolve `operation_id`, o estado vem de `GET /v1/operations/:id`.
- **BFF** — a camada Go do `theo-cloud` que a tela chama; ela cunha a credencial por inquilino.

### Architecture boundaries affected

- **Tela → BFF → registry.** A tela nunca fala com o registry direto; o BFF é a fronteira que
  detém a credencial por inquilino (Model B). Este plano **estende** o BFF com rotas novas e não
  cria caminho alternativo.
- **Leitura × escrita separadas por credencial.** `data_client.go` (`skills:read`) e
  `write_client.go` (`skills:publish`) são clientes distintos de propósito. As rotas novas de
  escrita (criar, excluir, visibilidade) vão pelo cliente de escrita; o playground vai pelo de
  leitura. Cruzar isso destruiria o controle.
- **Lógica pura fora do React** (`CLAUDE.md` deste repo): reescala de score, rótulo de perna e
  validação de frontmatter nascem em `.ts` testáveis sem browser, não dentro de componentes.
- `rules/architecture.md` § módulos coesos — orçamento de 500 LoC por arquivo respeitado; o
  playground e a autoria ficam em arquivos próprios em vez de inflar `skills.tsx`.

## Prior Art & Related Work

- **Blueprint interno** — `.claude/knowledge-base/discoveries/blueprints/m31-skills-journeys-blueprint.md`,
  verdict SHIPPABLE 100/100. Consome-se aqui:
  - `Blueprint §"D2 — Reescalar o score para exibição, mantendo o bruto no contrato"` → a reescala
    0-100 acontece **na tela**, não no servidor (T2.1).
  - `Blueprint §"Recommendations"` R4 (playground com score reescalado + perna, desempate
    determinístico) e R5 (validação no cliente antes do round-trip) — as duas recomendações que
    restaram do eixo de tela.
  - `Blueprint §"Q3 — o que é validável antes de publicar?"` → as regras estáticas checáveis no
    cliente: `name` 1–64 chars, minúsculas/números/hífen, sem hífen inicial, final ou duplo.
- **Auditorias internas** —
  `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` (violações do `DESIGN.md` com
  evidência, arquitetura de informação proposta) e
  `.claude/knowledge-base/audits/2026-08-04-skills-vs-memory-padrao-medido.md` (os cinco padrões
  medidos na navegação real do Memory que este plano reproduz).
- **Precedente interno de primeira ordem — Promptly.** A mesma capacidade já foi resolvida no
  mesmo dashboard, com a mesma forma: `../theo-cloud/dashboard/src/pages/promptly/create.tsx`
  (187 LoC, autoria) e `../theo-cloud/dashboard/src/pages/promptly/playground.tsx` (381 LoC,
  playground), com jornadas e2e próprias (`promptly-authoring-journey.spec.ts`,
  `promptly-playground-journey.spec.ts`). **Copiar a forma do Promptly é o caminho barato e
  consistente** — não inventar um layout novo para skills.
- **Contrato de design** — `../theo-cloud/dashboard/DESIGN.md` v1.0 (locked, 803 linhas): §2.2
  (coreografia destrutiva), §5.1 (EmptyState de 4 elementos com CTA in-app), §6.1 (erro de 6
  elementos), §10.2 (requisitos universais de tabela).
- **Sem `*-patterns` skill aplicável** — verificado: `.claude/skills/*-patterns/` não existe neste
  projeto.

## Objective

- [ ] Sub-goal 1 — O BFF expõe as rotas que faltam (descoberta, validação, criação, exclusão,
      visibilidade, operação), cada uma com teste em `skills_dashboard_test.go`.
- [ ] Sub-goal 2 — Nenhuma tela de skills sem ação: CTA no overview, `EmptyState` com CTA in-app,
      breadcrumb nas rotas aninhadas, `Retry` no erro, `CopyButton` na instrução.
- [ ] Sub-goal 3 — A lista aguenta escala: busca e paginação reais consumindo `next_page_token`.
- [ ] Sub-goal 4 — O playground devolve resultados com score legível **e qual perna casou**.
- [ ] Sub-goal 5 — A autoria valida sem publicar, posiciona o erro por `field`/`line`, publica
      acompanhando a operação e oferece testar a descoberta no sucesso.
- [ ] Sub-goal 6 — Excluir e alterar visibilidade existem sob a coreografia do `DESIGN.md` §2.2.
- [ ] Sub-goal 7 — Toda tela nova é alcançável **por clique**, coberta por e2e.

## ADRs

### D1 — O BFF ganha rotas explícitas por operação, não um proxy genérico

**Decisão:** cada operação nova (`:retrieve`, `:validate`, criar, excluir, visibilidade, operação)
vira um handler nomeado em `skills_dashboard.go`, montado explicitamente, reusando `proxy` e
`writeRejection`.

**Rationale:** o BFF é a fronteira de credencial. Um proxy genérico (`/v1/dashboard/skills/*` →
registry) transformaria a tela em cliente do registry inteiro e faria a escolha entre credencial de
leitura e de escrita virar dado de request — exatamente o que a separação
`data_client`/`write_client` existe para impedir. `rules/architecture.md` § fronteiras.

**Alternativas consideradas:**

1. **Proxy genérico de path.** Rejeitada: qualquer rota nova do registry passaria a ser alcançável
   pela sessão do dashboard sem revisão, e a escolha de credencial deixaria de ser estrutural.
2. **A tela falar direto com o registry.** Rejeitada: a credencial por inquilino é cunhada no
   broker do servidor (`internal/skills/broker.go`); expô-la ao browser é vazamento.

**Consequences:** mais linhas no BFF e um teste por rota; em troca, cada capacidade nova é uma
decisão explícita e auditável. O arquivo cresce — o orçamento de 500 LoC obriga a extrair os
handlers de escrita para um arquivo irmão (T0.2).

### D2 — A reescala do score 0-100 acontece na tela; o contrato devolve o bruto

**Decisão:** o dashboard converte o score RRF para 0-100 para exibição; a API continua devolvendo o
valor bruto e o `matched`.

**Rationale:** herdado do `Blueprint §"D2"`. O score bruto (`≈0,0163`) é ilegível para humano e a
diferença entre `0,0163` e `0,0161` não comunica nada; mas os outros consumidores (CLI, MCP, SDK,
agente) não são humanos e perderiam precisão com a reescala no servidor.

**Alternativas consideradas:**

1. **Reescalar no servidor.** Rejeitada pelo blueprint com evidência: o peer
   `mcp-gateway-registry` pode fazê-lo porque a única saída dele é a tela; a nossa não é.
2. **Não reescalar em lugar nenhum.** Rejeitada: entrega ao operador um número que ele não sabe ler.

**Consequences:** a regra vira lógica pura (`retrieve-projection.ts`), testável fora do React — o
que o `CLAUDE.md` do `theo-skills` já exige das telas desta capacidade.

### D3 — A perna que casou é texto, nunca só cor

**Decisão:** o resultado do playground rotula a perna com a palavra (`léxica (FTS)` / `vetorial`),
podendo ter cor como reforço — nunca como único portador da informação.

**Rationale:** `DESIGN.md` §12 (acessibilidade é requisito de produção) e precedente da própria
tela de skills, que já acerta isso com `local`/`remote` em `skills.tsx:94-99`.

**Alternativas consideradas:**

1. **Só um badge colorido.** Rejeitada: falha para daltônicos e para leitor de tela — e a
   informação de perna é justamente o diferencial que o produto vende.
2. **Só o número do rank por perna.** Rejeitada: o rank sem o nome da perna não responde a pergunta
   do operador ("achou porque as palavras batem ou porque entendeu?").

**Consequences:** o teste de projeção assevera o rótulo textual, não a classe CSS.

### D4 — Validação no cliente é atalho de latência, nunca a autoridade

**Decisão:** o editor de autoria checa no browser as regras estáticas do frontmatter (`name`
1–64, minúsculas/números/hífen, sem hífen duplo/inicial/final; `description` 1–1024) para dar
resposta imediata, **e sempre** submete a `POST /v1/skills:validate` antes de publicar. O veredito
que governa é o do servidor.

**Rationale:** `Blueprint §"Q3"` — a spec define o formato, não o diagnóstico; nosso `:validate` já
está à frente da spec ao devolver `field`/`line`. Duplicar a regra no cliente é aceitável como UX
(feedback enquanto digita), mas tratá-la como autoridade criaria duas fontes de verdade divergindo
em silêncio — violação de DRY sobre conhecimento (Regra 12).

**Alternativas consideradas:**

1. **Só validar no servidor.** Rejeitada: um round-trip por tecla é inviável e o autor descobre o
   erro tarde demais.
2. **Só validar no cliente.** Rejeitada: o cliente não conhece unicidade de nome, limites de
   payload nem secret scan — publicaria lixo achando que validou.

**Consequences:** a regra do cliente é deliberadamente um **subconjunto**; o código diz isso em
comentário e o teste assevera que um `SKILL.md` aprovado no cliente ainda pode ser reprovado pelo
servidor sem que a tela minta ("validado localmente" ≠ "válido").

### D5 — Excluir é `DangerZone` com frase digitada; despublicar não existe neste plano

**Decisão:** a exclusão segue a coreografia do §2.2 (zona segregada, `ConfirmDialog`, parágrafo de
impacto, declaração de reversibilidade, frase digitada). **Desativar/deprecar não entra aqui.**

**Rationale:** o registro hoje só tem `ACTIVE` e `DELETED`
(`packages/core/src/infrastructure/db/schema.ts:71`; `skills-store.ts:397` faz soft-delete com
reserva de id). Não existe estado de "deprecada". Construir a tela de um estado que o domínio não
tem seria fabricar capacidade.

**Alternativas consideradas:**

1. **Incluir deprecação neste plano.** Rejeitada: exige mudança de domínio, schema, contrato e
   efeito na busca — escopo de milestone próprio (M32), fora da DoD do M31. YAGNI aqui é regra, não
   preferência.
2. **Usar exclusão como se fosse desativação.** Rejeitada e perigosa: a exclusão reserva o id e
   quebra quem já referencia a skill; apresentá-la como "desativar" mentiria sobre o efeito.

**Consequences:** a tela dirá a verdade sobre o que a exclusão faz (incluindo a reserva do id).
Deprecação fica registrada como trabalho de M32.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| O plano atravessa dois repositórios: artefatos aqui, código no `theo-cloud`. Uma metade pode avançar sem a outra e o milestone fica meio-entregue | **Alta** | O checkbox só vira por `/acceptance M31` navegando o `app-dev` — que independe de onde o código mora. O plano declara `target_project: theo-cloud` e os caminhos resolvem por prefixo verificado | autor do plano |
| O playground pode expor que a perna vetorial quase não contribui (o M4 mediu 0.308 com o embedder stub) e parecer defeito da tela | Média | A tela mostra o dado como ele é e a seção diz "é a mesma busca que o agente usa". Se o desequilíbrio incomodar, o alvo é o embedder, não a tela | autor + operador |
| Seis rotas novas no BFF inflam `skills_dashboard.go` além do orçamento de 500 LoC | Média | T0.2 extrai as escritas para `skills_dashboard_write.go` antes de o arquivo estourar | implementador |
| Validação duplicada cliente/servidor pode divergir com o tempo | Média | D4 torna o cliente explicitamente um subconjunto; teste assevera que o veredito do servidor prevalece | implementador |
| A jornada de autoria depende da LRO: publicar não é síncrono e a tela pode parecer travada | Média | A tela acompanha `GET /v1/operations/:id` com estado visível e limite de espera; falha vira erro de 6 elementos com Retry, não spinner infinito | implementador |
| Escrita pela sessão do dashboard amplia o que uma sessão comprometida pode fazer (antes: só promover canal; agora: criar e excluir) | **Alta** | As rotas de escrita passam pelo `write_client` com escopo próprio e exigem JWT (`requireJWT`); a exclusão exige frase digitada. Registrado como superfície nova — não é mitigada a zero | implementador |
| A auditoria de origem navegou com **3 skills**; busca e paginação não foram vistas sob carga | Média | T1.3 inclui teste com acervo sintético > 100 itens, que é onde a paginação silenciosa morde | implementador |

## Unresolved Questions

- **Q1** — O `POST /v1/skills` aceita `SKILL.md` avulso (sem ZIP) conforme o M30; a tela precisa
  confirmar o **content-type e o formato exato do corpo** que o BFF deve encaminhar. A auditoria
  afirma o suporte; o formato precisa ser lido no handler antes de T0.3.
- **Q2** — Qual o comportamento esperado quando a skill criada é publicada mas fica
  `embedded: false` (sem embedding)? O sucesso deve oferecer "testar descoberta" mesmo sabendo que
  ela não será achada pela perna vetorial? Proposta: sim, e a tela diz isso explicitamente — mas é
  decisão de produto, não de implementação.
- **Q3** — A exclusão reserva o id por um período (`reservedUntil`). Qual o valor real dessa janela,
  para a tela declará-lo com honestidade em vez de dizer "não pode ser desfeito"? Precisa ser lido
  de `skills-store.ts` antes de escrever o texto do `ConfirmDialog`.
- **Q4** — O rodapé afirma "10 operational, 0 unreachable" enquanto telas mostram serviço
  inalcançável (achado colateral da auditoria de 2026-08-04). Não é escopo deste plano, mas se a
  contradição aparecer durante a aceitação, ela é ruído sobre a evidência.

## Dependency Graph

```
Phase 0 (BFF — Go) ─────────┬──▶ Phase 2 (Playground)
                            ├──▶ Phase 3 (Autoria)
                            └──▶ Phase 4 (Governança)
                                        │
Phase 1 (contrato nas telas ────────────┤
        existentes — sem backend)       │
        ‖ paralelo à Phase 0            ▼
                                 Phase 5 (Navegação + e2e)
```

- **Phase 0 e Phase 1 correm em paralelo** — a Phase 1 não precisa de rota nova.
- **Phases 2, 3, 4 dependem da Phase 0** e são independentes entre si (podem paralelizar).
- **Phase 5 fecha** — exige todas as telas existirem.

---

## Phase 0: O BFF abre as rotas que faltam

**Objective:** dar ao dashboard acesso, sob credencial correta, às seis operações do registry que
hoje não têm caminho.

### T0.1 — Proxy de descoberta (`:retrieve`) pelo cliente de leitura

#### Objective
Expor `POST /v1/dashboard/skills:retrieve` no BFF, encaminhando ao `:retrieve` do registry com a
credencial de leitura, preservando `score` e `matched` na resposta.

#### Why this step (action + reasoning)

**O que faz:** adiciona um handler `Retrieve` em `skills_dashboard.go`, montado no grupo já
protegido por `requireJWT`, que chama o registry via `data_client.go`.

**Por que agora:** é a rota que destrava a Phase 2, o maior valor por esforço segundo a
`sequência sugerida` da auditoria de origem, e a única que torna visível a promessa central do
produto. Vai primeiro porque as outras jornadas (autoria) terminam oferecendo "testar descoberta" —
sem esta rota, aquele CTA seria um beco. Decisão D1.

#### Evidence
- `../theo-cloud/internal/routes/skills_dashboard.go:185-189` — hoje há 5 leituras montadas, nenhuma é `:retrieve`.
- `packages/api/src/server/handlers/retrieve.ts:95-96` — o `matched` já é produzido pelo registry.
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"O que dá para construir com o BFF de hoje" — linha "Playground de descoberta → **sim**, proxy de `:retrieve`".

#### Files to edit
```
../theo-cloud/internal/routes/skills_dashboard.go — handler Retrieve + montagem da rota
../theo-cloud/internal/skills/data_client.go — método Retrieve (POST com corpo de consulta)
../theo-cloud/internal/routes/skills_dashboard_test.go — RED primeiro
```

#### Deep file dependency analysis
- `skills_dashboard.go` (Baseline: 274 LoC, `172219d`) hoje só tem handlers de leitura com `proxy`.
  Ganha `Retrieve`, que difere dos demais por ter **corpo**; reusa `proxy` e `writeRejection` para
  que a recusa tipada do upstream continue chegando à tela.
- `data_client.go` (Baseline: 138 LoC) hoje só faz GET. Ganha um POST — mantendo o escopo
  `skills:read`, porque `:retrieve` é leitura apesar do verbo.
- Downstream: `skills-api.ts` (Phase 2) e `skills-handlers.ts` (mock).

#### Deep Dives
- **Corpo da requisição:** `{ query: string, top_k: number, strategy?: string }` — encaminhado como
  veio, sem reinterpretação (o registry é a autoridade sobre os limites de `top_k`).
- **Invariante:** o `data_client` **não** ganha capacidade de escrita (Baseline § invariantes).
- **Edge case:** consulta vazia — o registry recusa com erro tipado; o BFF não inventa validação
  própria, apenas repassa a recusa (`writeRejection`), senão a mensagem que a tela mostra passa a
  ser nossa paráfrase e envelhece.
- **Edge case:** acervo sem nenhuma skill embedded — resposta 200 com lista possivelmente vazia na
  perna vetorial. Não é erro.

#### Pseudo-code / Signatures

```pseudocode
func (h *SkillsDashboardHandler) Retrieve(w, r):
  body = read_and_limit(r.Body, MAX_QUERY_BODY)
  h.proxy(w, r, "skills.retrieve", func():
      return h.client.Retrieve(r.Context(), body))

# Example
input:  POST /v1/dashboard/skills:retrieve  {"query":"converter documento","top_k":5}
output: 200 {"skills":[{"skill_id":"universal-doc","score":0.0163,
                        "matched":[{"leg":"keyword","rank":1},{"leg":"vector","rank":3}]}]}
```

#### Tasks
1. Escrever o teste RED que asserta 200 + corpo repassado e 4xx tipado preservado.
2. Adicionar `Retrieve` ao `data_client.go` (POST, escopo de leitura).
3. Adicionar o handler `Retrieve` e montá-lo em `MountSkillsDashboard`.
4. Registrar o handler MSW correspondente em `skills-handlers.ts`.

#### TDD
```
RED:     TestRetrieve_repassa_resultado_com_matched() — 200 e `matched` presente no corpo devolvido
RED:     TestRetrieve_preserva_recusa_tipada_do_upstream() — 422 do registry chega como 422 com o texto do serviço, não 502 genérico
GREEN:   Implementar client + handler + montagem
REFACTOR: Nenhum esperado (reusa `proxy`/`writeRejection`)
VERIFY:  cd ../theo-cloud && go test ./internal/routes/... -run Retrieve
```

#### Concurrency tests
```
(none — single-threaded)
```
O handler é stateless: não compartilha estado mutável entre requisições, apenas encaminha ao
cliente HTTP, que já é seguro para uso concorrente por contrato da stdlib.

#### Acceptance Criteria
- [ ] `POST /v1/dashboard/skills:retrieve` responde 200 com `score` e `matched` intactos
- [ ] Recusa do upstream chega com status e texto do serviço (não 502 genérico)
- [ ] A rota exige JWT (está sob `requireJWT`)
- [ ] Pass: lint — `go vet ./...` e `golangci-lint run` sem avisos nos arquivos alterados
- [ ] Pass: size — `skills_dashboard.go` ≤ 500 linhas

#### DoD
- [ ] `go test ./internal/...` verde
- [ ] Handler MSW registrado
- [ ] CHANGELOG deste repo atualizado sob `[Unreleased]`

---

### T0.2 — Rotas de escrita em arquivo próprio: criar, excluir, visibilidade

#### Objective
Expor `POST /v1/dashboard/skills`, `DELETE /v1/dashboard/skills/{id}` e
`PUT /v1/dashboard/skills/{id}/visibility` pelo cliente de escrita, num arquivo irmão.

#### Why this step (action + reasoning)

**O que faz:** cria `skills_dashboard_write.go` com os três handlers de escrita e sua montagem,
seguindo o precedente do `SkillsPromotionHandler`, que já é um handler de escrita separado com
cliente próprio.

**Por que agora:** as Phases 3 e 4 dependem destas rotas, e fazê-las no mesmo arquivo estouraria o
orçamento de 500 LoC (Baseline: 274 hoje + seis handlers). A separação também é a que mantém
visível qual credencial cada grupo usa — a razão da D1.

#### Evidence
- `../theo-cloud/internal/routes/skills_dashboard.go:212,269` — `SkillsPromotionHandler` já é o
  precedente de escrita separada com `skillsPromoter`.
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"Quem opera — existe pela metade" —
  "Faltam, todos com API pronta: `DELETE /v1/skills/:id`, `PATCH`, `PUT .../visibility`".

#### Files to edit
```
../theo-cloud/internal/routes/skills_dashboard_write.go (NEW) — Create, Delete, SetVisibility + montagem
../theo-cloud/internal/skills/write_client.go — métodos Create, Delete, SetVisibility
../theo-cloud/internal/routes/skills_dashboard_write_test.go (NEW) — RED primeiro
```

#### Deep file dependency analysis
- `write_client.go` (Baseline: 98 LoC, `37aa36f`) hoje só promove canal. Ganha três métodos; o
  tratamento de erro continua passando por `upstream_error.go`, invariante do Baseline.
- O arquivo novo importa o `writeRejection` já existente — sem duplicar a política de erro (DRY).
- Downstream: `skills-api.ts` (Phases 3 e 4), `skills-handlers.ts`.

#### Deep Dives
- **Q1 é pré-requisito desta task:** antes de implementar `Create`, ler o handler
  `packages/api/src/server/handlers/publishing.ts` para confirmar content-type e forma do corpo do
  `SKILL.md` avulso. Implementar por suposição aqui é como se fabrica um endpoint que responde 400
  para sempre.
- **Invariante de segurança:** as três rotas ficam sob `requireJWT`, como a promoção
  (`skills_dashboard.go:269-272`).
- **Edge case:** excluir skill inexistente → 404 do upstream repassado, não 500.
- **Edge case:** visibilidade para valor não suportado → recusa tipada do registry, repassada.

#### Tasks
1. Ler `publishing.ts` e registrar a resposta de Q1 no plano/implementação (não supor).
2. Escrever os testes RED das três rotas, incluindo preservação de 404 e 4xx tipado.
3. Adicionar os três métodos ao `write_client.go`.
4. Criar `skills_dashboard_write.go` com handlers + `MountSkillsDashboardWrite`.
5. Registrar os handlers MSW.

#### TDD
```
RED:     TestCreate_publica_e_devolve_operation_id() — 200/202 com `operation_id` no corpo
RED:     TestDelete_preserva_404_do_upstream() — skill inexistente → 404, não 500
RED:     TestSetVisibility_preserva_recusa_tipada() — valor inválido → status e texto do serviço
GREEN:   Implementar client + handlers + montagem
REFACTOR: Extrair helper de corpo JSON se os três handlers duplicarem parsing
VERIFY:  cd ../theo-cloud && go test ./internal/routes/... ./internal/skills/...
```

#### Concurrency tests
```
(none — single-threaded)
```
Handlers stateless; nenhum estado compartilhado entre requisições.

#### Acceptance Criteria
- [ ] As três rotas respondem e exigem JWT
- [ ] Erro do upstream preservado em status e texto nas três
- [ ] `skills_dashboard.go` permanece ≤ 500 linhas e o arquivo novo também
- [ ] Pass: lint — `golangci-lint run` limpo nos arquivos alterados

#### DoD
- [ ] `go test ./internal/...` verde
- [ ] Q1 respondida com citação do handler lido
- [ ] CHANGELOG atualizado

---

### T0.3 — Proxy de validação (`:validate`) e de operação (`operations/:id`)

#### Objective
Expor `POST /v1/dashboard/skills:validate` e `GET /v1/dashboard/operations/{id}` para a jornada de
autoria acompanhar validação e publicação.

#### Why this step (action + reasoning)

**O que faz:** adiciona o proxy do `:validate` (sem efeito colateral, portanto pelo cliente de
leitura) e o de leitura de operação, que é como a publicação reporta progresso.

**Por que agora:** a Phase 3 inteira depende dos dois — validar antes de publicar e depois
acompanhar a LRO. Sem o segundo, a tela publica e não sabe dizer se deu certo, que é o defeito que
a jornada de autoria existe para eliminar.

#### Evidence
- `packages/api/src/server/handlers/operations.ts` — o endpoint de operação existe no registry.
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"Quem autora — hoje não existe" —
  o diagrama da jornada cita `GET /v1/operations/:id` como o passo entre publicar e o sucesso.
- `Blueprint §"Q3 — o que é validável antes de publicar?"` — o `:validate` devolve `field` e `line`.

#### Files to edit
```
../theo-cloud/internal/routes/skills_dashboard.go — handlers Validate e Operation + montagem
../theo-cloud/internal/skills/data_client.go — métodos Validate e Operation
../theo-cloud/internal/routes/skills_dashboard_test.go — RED primeiro
```

#### Deep file dependency analysis
- `:validate` é POST **sem efeito colateral** — vai pelo cliente de leitura de propósito: se fosse
  pelo de escrita, uma sessão sem permissão de publicar não conseguiria sequer conferir o próprio
  rascunho.
- Downstream: `create.tsx` (Phase 3).

#### Deep Dives
- **Invariante crítica:** a resposta de `:validate` carrega `field` e `line`; o proxy **não pode
  achatar** o corpo em uma mensagem só — é exatamente esse detalhe que posiciona o cursor no editor.
- **Edge case:** `SKILL.md` sintaticamente quebrado → o registry responde com erro tipado; repassar.
- **Edge case:** operação ainda em curso → 200 com estado intermediário. Não é erro.

#### Tasks
1. Testes RED: `field`/`line` sobrevivem ao proxy; operação em curso não vira erro.
2. Métodos no `data_client.go`.
3. Handlers + montagem.
4. Handlers MSW com um caso de erro posicionado.

#### TDD
```
RED:     TestValidate_preserva_field_e_line() — corpo de erro chega com os dois campos intactos
RED:     TestOperation_em_curso_nao_e_erro() — estado intermediário devolve 200
GREEN:   Implementar
REFACTOR: Nenhum esperado
VERIFY:  cd ../theo-cloud && go test ./internal/routes/... -run 'Validate|Operation'
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `field` e `line` chegam à tela sem achatamento
- [ ] Operação em curso é 200, não erro
- [ ] Pass: lint limpo

#### DoD
- [ ] `go test ./internal/...` verde
- [ ] CHANGELOG atualizado

---

## Phase 1: O contrato do DESIGN.md nas telas que já existem

**Objective:** tirar `/skills` da condição de *dead page* e fechar as seis violações medidas — sem
depender de rota nova.

### T1.1 — Overview deixa de ser tela morta: ação principal, EmptyState com CTA, erro com Retry

#### Objective
`/skills` passa a ter ação principal visível, `EmptyState` de 4 elementos com CTA in-app, e erro
com Retry.

#### Why this step (action + reasoning)

**O que faz:** adiciona ao `PageShell` a ação primária (**Nova skill**) e a secundária (**Testar
descoberta**), reescreve o `EmptyState` com os quatro elementos do §5.1, e troca o `Alert` atual por
um erro com ação.

**Por que agora:** é a violação mais grave medida (§4.1 — zero botões numa `main` saudável) e não
depende de backend. Fazer isto primeiro entrega valor mesmo que as Phases 2–4 atrasem.

#### Evidence
- `../theo-cloud/dashboard/src/pages/skills.tsx:115-121` — o `Alert` tem título e descrição, **sem** ação.
- `../theo-cloud/dashboard/src/pages/skills.tsx:138-148` — `EmptyState` sem `cta`, texto manda usar a CLI.
- `.claude/knowledge-base/audits/2026-08-04-skills-vs-memory-padrao-medido.md` §"O contraste em um número" — Memory 8 acionáveis em erro; Skills 0 saudável.
- `../theo-cloud/dashboard/DESIGN.md` §5.1 e §6.1.

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills.tsx — ações do PageShell, EmptyState, erro com Retry
../theo-cloud/dashboard/src/pages/skills.test.tsx — RED primeiro
```

#### Deep file dependency analysis
- `skills.tsx` (Baseline: 153 LoC, `767d001`) preserva as invariantes do Baseline: continua
  distinguindo "falhou a leitura" de "não há nada" (os dois textos do `EmptyState` atual, linhas
  141-146) e continua mostrando `execution` como texto.
- Os botões apontam para rotas criadas nas Phases 2 e 3 — até lá, ficam **desabilitados com
  motivo**, nunca ocultos, para não criar link morto.

#### Deep Dives
- **§6.1 pede seis elementos.** O erro passa a ter título, causa, **impacto** ("não é possível saber
  o que existe no registro") e **ação** (`Retry` que refaz a query). Os dois CTAs opcionais ficam
  para quando houver bundle de diagnóstico.
- **Invariante que não pode regredir:** o texto de erro nunca pode sugerir "não há skills". A
  distinção já existe e é a lição que o `theo-trust` pagou caro.
- **Edge case:** carregando — skeleton, não spinner (§10.2).

#### Tasks
1. Testes RED: existe ação primária; erro renderiza botão Retry que refaz a query; `EmptyState` tem CTA.
2. Adicionar ações ao `PageShell`.
3. Reescrever `EmptyState` com os 4 elementos e comando copiável como fallback secundário.
4. Substituir o `Alert` por erro com ação.

#### TDD
```
RED:     overview_tem_acao_principal() — a `main` renderiza ao menos um botão
RED:     erro_de_leitura_oferece_retry() — clicar Retry dispara refetch
RED:     empty_state_tem_cta_in_app() — CTA aponta para rota interna, não para docs
RED:     erro_nao_diz_que_nao_ha_skills() — o texto de falha preserva a distinção
GREEN:   Implementar
REFACTOR: Extrair o EmptyState para componente se passar de ~30 linhas inline
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- skills
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] A `<main>` de `/skills` tem ≥ 1 elemento acionável em **todos** os estados (ok, vazio, erro)
- [ ] `EmptyState` passa os 4 critérios do §5.3
- [ ] Erro tem título + causa + impacto + ação
- [ ] Pass: lint — `pnpm lint` limpo; Pass: typecheck — `pnpm typecheck` limpo
- [ ] Pass: size — `skills.tsx` ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

### T1.2 — Breadcrumb nas rotas aninhadas e CopyButton na instrução resolvida

#### Objective
Detalhe e versões ganham breadcrumb com volta à origem; a instrução resolvida ganha botão de copiar.

#### Why this step (action + reasoning)

**O que faz:** adiciona breadcrumb em `/skills/:id` e `/skills/:id/versions`, e troca o `<pre>` da
instrução por bloco com `CopyButton`.

**Por que agora:** §1 (Q1) e §11.1 do `DESIGN.md`; hoje a única volta é o item de menu, que leva ao
overview e não à origem. É trabalho de tela pura, entra junto com T1.1.

#### Evidence
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"Violações do DESIGN.md" — linhas §1(Q1) e §11.1.
- `../theo-cloud/dashboard/src/pages/skills/detail.tsx` (Baseline: 156 LoC) — instrução em `<pre>` sem copiar.

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills/detail.tsx — breadcrumb + CopyButton
../theo-cloud/dashboard/src/pages/skills/versions.tsx — breadcrumb
../theo-cloud/dashboard/src/pages/skills/detail.test.tsx — RED primeiro
../theo-cloud/dashboard/src/pages/skills/versions.test.tsx — RED primeiro
```

#### Deep file dependency analysis
- `versions.tsx` (Baseline: 241 LoC, `aa8944c`) — a promoção existente **não pode regredir**; o
  breadcrumb é aditivo e o teste de promoção continua verde.
- O `EmptyState` de versões ("0 versões → use a CLI") ganha comando copiável e CTA in-app.

#### Deep Dives
- **Invariante:** a instrução resolvida é o texto que o agente carrega; `origin: public` continua
  marcado como "publicada por terceiro" (Baseline § invariantes) — copiar não altera essa marcação.
- **Edge case:** clipboard indisponível (contexto inseguro) → o botão informa a falha em vez de
  fingir sucesso.

#### Tasks
1. Testes RED: breadcrumb existe e volta para `/skills`; CopyButton copia o conteúdo.
2. Adicionar breadcrumb nas duas telas.
3. Trocar `<pre>` por bloco com `CopyButton`.
4. Completar o `EmptyState` de versões.

#### TDD
```
RED:     detalhe_tem_breadcrumb_para_o_acervo() — link de volta presente e aponta para /skills
RED:     versoes_tem_breadcrumb_para_a_skill() — volta para o detalhe, não para o overview
RED:     instrucao_pode_ser_copiada() — CopyButton presente com estados
GREEN:   Implementar
REFACTOR: Nenhum esperado
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- skills
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] As duas rotas aninhadas têm breadcrumb, e a volta é para a origem (não para o overview)
- [ ] `CopyButton` com estados (§11.1)
- [ ] Promoção de canal continua funcionando (teste existente verde)
- [ ] Pass: lint + typecheck limpos

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

### T1.3 — A lista aguenta escala: busca e paginação reais

#### Objective
Consumir `next_page_token` e adicionar busca, de modo que acima de 100 skills nada suma em silêncio.

#### Why this step (action + reasoning)

**O que faz:** adiciona campo de busca acima da tabela e navegação de páginas consumindo o
`next_page_token` que **já vem tipado na resposta e é ignorado**.

**Por que agora:** é um critério explícito da DoD do M31 ("o acervo aguenta escala") e um defeito
silencioso: nada erra, o excedente simplesmente não existe para quem olha.

#### Evidence
- `../theo-cloud/dashboard/src/pages/skills.tsx:47-50` — `next_page_token` está no tipo `SkillsPayload` e **não é lido** em lugar nenhum do arquivo.
- `../theo-cloud/dashboard/src/pages/skills.tsx:32` — `PAGE_LIMIT = 100` fixo.
- `../theo-cloud/dashboard/DESIGN.md` §10.2 — busca quando N>10, paginação em N>50.

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills.tsx — estado de busca + paginação
../theo-cloud/dashboard/src/components/skills/skills-api.ts — fetchSkills aceita page_token e query
../theo-cloud/dashboard/src/pages/skills.test.tsx — RED primeiro
../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts — mock paginado com > 100 itens
```

#### Deep file dependency analysis
- `skills-api.ts` (Baseline: 76 LoC) — `fetchSkills(limit)` ganha parâmetros opcionais mantendo
  `throwOnError: true`, a invariante do Baseline. Assinatura estendida, não substituída: os callers
  atuais continuam válidos.
- O mock precisa de acervo sintético > 100 para o teste exercitar a segunda página — sem isso o
  teste passaria sem nunca provar nada.

#### Deep Dives
- **Decisão de escopo:** busca **no servidor** se o registry aceitar filtro; caso contrário, busca
  no cliente sobre a página corrente, e a tela **diz** que filtra a página atual — nunca sugerir que
  filtrou o acervo inteiro quando não filtrou.
- **Edge case:** `next_page_token: null` → controle de próxima página desabilitado, não escondido.
- **Edge case:** busca sem resultado → estado vazio **de busca** ("nada casa com X" + limpar), que é
  diferente de acervo vazio.

#### Pseudo-code / Signatures

```pseudocode
function fetchSkills<T>(limit: number, opts?: { pageToken?: string; query?: string }): Promise<T|null>
  url = `${BASE}?limit=${limit}`
  if opts.pageToken: url += `&page_token=${encode(opts.pageToken)}`
  if opts.query:     url += `&q=${encode(opts.query)}`
  return cloudFetch(url, {}, { throwOnError: true })

# Example
input:  fetchSkills(100, { pageToken: "tok_2" })
output: { skills: [...100 itens...], next_page_token: "tok_3" }
```

#### Tasks
1. Mock com 250 skills sintéticas e paginação real.
2. Testes RED: segunda página é alcançável; token nulo desabilita o controle; busca vazia tem estado próprio.
3. Estender `fetchSkills`.
4. Adicionar busca e paginação à tela.

#### TDD
```
RED:     acervo_acima_do_limite_nao_some() — com 250 itens, a segunda página é alcançável pela UI
RED:     ultima_pagina_desabilita_proxima() — `next_page_token` nulo → controle desabilitado
RED:     busca_sem_resultado_tem_estado_proprio() — distinto de "acervo vazio"
GREEN:   Implementar
REFACTOR: Extrair a barra de busca/paginação se `skills.tsx` passar de 300 linhas
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- skills
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Com acervo > 100, nenhuma skill fica inalcançável pela UI
- [ ] Busca presente (§10.2, N>10)
- [ ] Estado vazio de busca ≠ estado vazio de acervo
- [ ] Pass: lint + typecheck limpos; `skills.tsx` ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Phase 2: Playground de descoberta

**Objective:** tornar visível a promessa central do produto — um agente achar a skill certa por
intenção — com score legível e a perna que casou.

### T2.1 — Projeção pura: reescala 0-100 e rótulo textual da perna

#### Objective
Criar a lógica pura que converte a resposta do `:retrieve` em algo legível, testável fora do React.

#### Why this step (action + reasoning)

**O que faz:** cria `retrieve-projection.ts` com a reescala do score e a tradução de `matched` em
rótulo textual, com desempate determinístico.

**Por que agora:** é a regra que a tela consome, e o `CLAUDE.md` do `theo-skills` exige que a
projeção seja testada fora do browser. Escrevê-la primeiro deixa a tela da T2.2 quase declarativa.
Decisões D2 e D3.

#### Evidence
- `Blueprint §"D2 — Reescalar o score para exibição, mantendo o bruto no contrato"` — a reescala é da tela.
- `Blueprint §"Q2"` — o peer reescala para 0-100 e desempata por identificador; as duas escolhas se aplicam.
- `packages/core/src/domain/retrievers/types.ts:62,68` — forma de `matched` (`leg` + `rank` 1-based).

#### Files to edit
```
../theo-cloud/dashboard/src/components/skills/retrieve-projection.ts (NEW)
../theo-cloud/dashboard/src/components/skills/retrieve-projection.test.ts (NEW) — RED primeiro
```

#### Deep Dives
- **Invariante honesta:** o RRF ignora magnitude — ele diz "apareceu em 1º na vetorial", não "casou
  0,91". A projeção **não pode** rotular o número como "similaridade" (`Blueprint §"Q1"`, trade-off
  registrado). O rótulo é "relevância", e a tela explica a escala.
- **Edge case:** `matched` ausente (consumidor antigo / resposta sem atribuição) → a projeção
  devolve "não informado", **nunca** assume uma perna. Inventar a perna seria mentir com aparência
  de dado — o risco que R6 do blueprint existe para impedir.
- **Edge case:** as duas pernas casaram → ambos os rótulos, com o rank de cada.
- **Edge case:** score zero ou lista de um item só → reescala não pode dividir por zero.

#### Pseudo-code / Signatures

```pseudocode
type Leg = 'keyword' | 'vector'
function projectResults(raw: RetrievedSkill[]): ProjectedResult[]
  -- ordena por score desc, desempate por skill_id asc (determinístico)
  max = maximum(raw.score) or 1
  for r in sorted(raw):
     relevance = round(r.score / max * 100)
     legs = r.matched ? r.matched.map(m => ({label: LABEL[m.leg], rank: m.rank})) : []
     append { ...r, relevance, legs, legsKnown: r.matched !== undefined }

# Example
input:  [{skill_id:"b", score:0.0163, matched:[{leg:"keyword",rank:1}]},
         {skill_id:"a", score:0.0163, matched:[{leg:"vector",rank:2}]}]
output: [{skill_id:"a", relevance:100, legs:[{label:"vetorial",rank:2}], legsKnown:true},
         {skill_id:"b", relevance:100, legs:[{label:"léxica (FTS)",rank:1}], legsKnown:true}]
```

#### Tasks
1. Testes RED cobrindo os quatro edge cases acima.
2. Implementar a projeção.

#### TDD
```
RED:     reescala_para_0_100_preservando_ordem()
RED:     empate_desempata_por_skill_id_ascendente() — determinismo independente do retriever que responder primeiro
RED:     matched_ausente_nao_inventa_perna() — legsKnown=false e nenhuma perna alegada
RED:     duas_pernas_produzem_dois_rotulos_com_rank()
RED:     lista_de_um_item_nao_divide_por_zero()
GREEN:   Implementar
REFACTOR: Nenhum esperado (função pura)
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- retrieve-projection
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Função pura, sem import de React
- [ ] `matched` ausente nunca vira perna alegada
- [ ] Desempate determinístico por `skill_id`
- [ ] Pass: coverage — 100% neste arquivo (é caminho crítico: governa o que a tela afirma)

#### DoD
- [ ] `pnpm test` verde; typecheck limpo
- [ ] CHANGELOG atualizado

---

### T2.2 — A tela do playground

#### Objective
`/skills/playground` executa a consulta e mostra os resultados com relevância e perna.

#### Why this step (action + reasoning)

**O que faz:** cria a tela consumindo T0.1 e T2.1, na forma do playground do Promptly.

**Por que agora:** é a jornada de maior valor por esforço segundo a auditoria, e o CTA de sucesso da
autoria (Phase 3) aponta para cá.

#### Evidence
- `.claude/knowledge-base/audits/2026-08-04-skills-vs-memory-padrao-medido.md` §"O Playground de Skills, derivado do padrão" — botão desabilitado até input válido; perna como texto; a seção diz que é a mesma busca do agente.
- `../theo-cloud/dashboard/src/pages/promptly/playground.tsx` (381 LoC) — precedente de forma no mesmo dashboard.

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills/playground.tsx (NEW)
../theo-cloud/dashboard/src/pages/skills/playground.test.tsx (NEW) — RED primeiro
../theo-cloud/dashboard/src/components/skills/skills-api.ts — retrieveSkills()
../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts — handler de :retrieve
```

#### Deep Dives
- **Padrão herdado, medido:** botão **Descobrir** nasce desabilitado até haver consulta; campos
  opcionais rotulados `(optional)`; a seção declara *"é a mesma busca que o agente usa"* — e essa
  frase só pode existir se for verdade (é: o BFF chama o mesmo `:retrieve`).
- **Edge case:** zero resultados → estado vazio que sugere o que fazer (revisar termos, conferir se
  a skill tem embedding), não "nada encontrado" seco.
- **Edge case:** todas as skills com `embedded: false` → a tela informa que a perna vetorial não
  contribuiu, em vez de deixar o operador achar que a busca está quebrada.
- **Edge case:** erro do serviço → erro de 6 elementos com Retry, não spinner infinito.

#### Tasks
1. Testes RED: botão desabilitado sem consulta; resultado mostra perna como texto; zero resultados tem estado próprio; erro tem Retry.
2. `retrieveSkills()` no `skills-api.ts` com `throwOnError: true`.
3. Handler MSW com um resultado de cada perna e um com as duas.
4. Implementar a tela usando a projeção da T2.1.

#### TDD
```
RED:     botao_descobrir_nasce_desabilitado() — sem consulta, sem submit morto
RED:     resultado_mostra_perna_como_texto() — a palavra aparece, não só cor (D3)
RED:     zero_resultados_sugere_proximo_passo()
RED:     erro_do_servico_oferece_retry()
GREEN:   Implementar
REFACTOR: Extrair a linha de resultado se a tela passar de 400 linhas
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- playground
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Consulta em linguagem natural devolve resultados com relevância **e** perna, em texto
- [ ] Botão desabilitado até input válido
- [ ] Estados vazio e de erro completos
- [ ] Pass: lint + typecheck; arquivo ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Phase 3: Autoria com validação prévia

**Objective:** permitir escrever, validar sem publicar e publicar acompanhando a operação.

### T3.1 — Validação de rascunho no cliente (subconjunto declarado)

#### Objective
Criar `skill-draft.ts` com as regras estáticas verificáveis no browser.

#### Why this step (action + reasoning)

**O que faz:** implementa a checagem de `name` e `description` conforme a spec, como lógica pura.

**Por que agora:** dá resposta enquanto a pessoa digita e é pré-requisito da tela. Decisão D4 — é
**subconjunto**, jamais autoridade.

#### Evidence
- `Blueprint §"Q3"` — tabela de restrições: `name` 1–64, minúsculas/números/hífen, sem hífen inicial/final, **sem hífen duplo**; `description` 1–1024.

#### Files to edit
```
../theo-cloud/dashboard/src/components/skills/skill-draft.ts (NEW)
../theo-cloud/dashboard/src/components/skills/skill-draft.test.ts (NEW) — RED primeiro
```

#### Deep Dives
- **Invariante de honestidade:** a função devolve `localChecksPassed`, nunca `valid`. O nome importa:
  a tela não pode dizer "válido" com base no cliente — o servidor conhece unicidade, limites de
  payload e secret scan, que o browser não conhece.
- **Edge case:** `name` com hífen duplo (`foo--bar`) → reprovado (é o caso que a spec destaca).
- **Edge case:** `description` com 1024 chars exatos → aprovado (limite inclusivo — edge, não negativo).
- **Edge case:** frontmatter ausente → reprovado com apontamento de campo, não exceção.

#### Tasks
1. Testes RED com casos-limite e negativos.
2. Implementar.

#### TDD
```
RED:     name_com_hifen_duplo_reprova()
RED:     name_com_64_chars_aprova_e_com_65_reprova()  — limite inclusivo
RED:     description_vazia_reprova_apontando_o_campo()
RED:     frontmatter_ausente_reprova_sem_lancar_excecao()
GREEN:   Implementar
REFACTOR: Nenhum esperado (função pura)
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- skill-draft
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] O retorno não usa a palavra "válido" para o resultado local
- [ ] Todos os casos-limite da spec cobertos
- [ ] Pass: coverage 100% neste arquivo

#### DoD
- [ ] `pnpm test` verde; typecheck limpo
- [ ] CHANGELOG atualizado

---

### T3.2 — A tela de autoria: validar, publicar, acompanhar, testar descoberta

#### Objective
`/skills/new` permite escrever, validar sem efeito colateral, publicar acompanhando a LRO, e o
sucesso oferece testar a descoberta.

#### Why this step (action + reasoning)

**O que faz:** cria a tela de autoria na forma do `promptly/create.tsx`, consumindo T0.2, T0.3 e T3.1.

**Por que agora:** fecha o critério "autoria sem publicar às cegas" da DoD, e é o consumidor que a
API do M30 nunca teve.

#### Evidence
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"Quem autora — hoje não existe" — o diagrama da jornada, incluindo o CTA de sucesso ser *testar descoberta*, não "voltar à lista".
- `../theo-cloud/dashboard/src/pages/promptly/create.tsx` (187 LoC) — precedente de forma.

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills/create.tsx (NEW)
../theo-cloud/dashboard/src/pages/skills/create.test.tsx (NEW) — RED primeiro
../theo-cloud/dashboard/src/components/skills/skills-api.ts — validateSkill(), createSkill(), fetchOperation()
../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts — handlers de validate/create/operation
```

#### Deep Dives
- **Erro posicionado:** a resposta do `:validate` traz `field` e `line`; a tela aponta o erro **na
  linha**, não num toast genérico (§6.1 e §6.3).
- **A LRO:** publicar devolve `operation_id`; a tela consulta o estado com limite de espera. Ao
  estourar, mostra erro com ação — nunca gira para sempre (risco registrado).
- **Edge case:** validação passa e publicação falha (nome já existe) → o erro do servidor prevalece
  e a tela **não** diz que estava validado; D4.
- **Edge case:** publicada com `embedded: false` → o sucesso oferece testar descoberta **e informa**
  que ela ainda não é achável pela perna vetorial (Q2 — decisão de produto a confirmar).

#### Tasks
1. Testes RED dos quatro comportamentos.
2. Funções de API com `throwOnError: true`.
3. Handlers MSW, incluindo um erro com `field`/`line`.
4. Implementar a tela.

#### TDD
```
RED:     validar_nao_publica() — validar não dispara POST /skills
RED:     erro_do_validate_e_posicionado_por_field_e_line()
RED:     publicacao_acompanha_a_operacao_ate_estado_terminal()
RED:     sucesso_oferece_testar_descoberta() — o CTA leva ao playground, não à lista
GREEN:   Implementar
REFACTOR: Extrair o painel de validação se a tela passar de 400 linhas
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- create
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Validar não tem efeito colateral (nenhuma chamada de criação)
- [ ] Erro aponta campo e linha
- [ ] Publicação mostra progresso e termina em estado terminal ou erro acionável
- [ ] CTA de sucesso é in-app e leva ao playground
- [ ] Pass: lint + typecheck; arquivo ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Phase 4: Governança com coreografia

**Objective:** excluir e alterar visibilidade pela tela, sob o §2.2, dizendo a verdade sobre o efeito.

### T4.1 — Excluir sob DangerZone com frase digitada

#### Objective
O detalhe ganha zona de perigo com exclusão confirmada por frase digitada.

#### Why this step (action + reasoning)

**O que faz:** adiciona `DangerZone` + `ConfirmDialog` ao detalhe, consumindo `DELETE` da T0.2.

**Por que agora:** fecha o critério "governança com coreografia" e resolve o defeito concreto do
acervo — uma skill que se declara removível e não pode ser removida por tela alguma.

#### Evidence
- `../theo-cloud/dashboard/DESIGN.md` §2.2 — a coreografia, em ordem.
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"O acervo tem lixo que a tela não deixa limpar".
- `packages/api/src/server/store/skills-store.ts:397` — o delete é soft e grava `reservedUntil`: o id fica reservado.

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills/detail.tsx — DangerZone + ConfirmDialog
../theo-cloud/dashboard/src/pages/skills/detail.test.tsx — RED primeiro
../theo-cloud/dashboard/src/components/skills/skills-api.ts — deleteSkill()
../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts — handler de DELETE
```

#### Deep Dives
- **Q3 é pré-requisito:** ler a janela real de `reservedUntil` antes de escrever o texto. A frase de
  impacto precisa dizer o que de fato acontece — que o identificador fica **reservado** e não pode
  ser reutilizado de imediato. Dizer "não pode ser desfeito" sem mencionar a reserva é impreciso;
  dizer "reversível" seria falso.
- **Invariante do §2.2:** botão `variant="destructive"`, nunca `primary`; sucesso navega para
  contexto seguro (o acervo) com confirmação.
- **Edge case:** frase digitada errada → submit permanece desabilitado.
- **Edge case:** exclusão recusada por permissão → erro tipado do serviço, com o texto dele.

#### Tasks
1. Responder Q3 lendo `skills-store.ts` e registrar o valor.
2. Testes RED: sem frase correta não submete; texto declara a reserva; sucesso navega para o acervo.
3. `deleteSkill()` + handler MSW.
4. Implementar a `DangerZone`.

#### TDD
```
RED:     submit_bloqueado_ate_frase_exata()
RED:     dialogo_declara_o_efeito_incluindo_reserva_do_id()
RED:     sucesso_navega_para_o_acervo_com_confirmacao()
RED:     recusa_por_permissao_mostra_texto_do_servico()
GREEN:   Implementar
REFACTOR: Nenhum esperado (usa composites canônicos)
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- detail
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Coreografia do §2.2 completa (zona, diálogo, impacto, reversibilidade, frase)
- [ ] O texto não afirma reversibilidade que não existe nem omite a reserva do id
- [ ] Botão destrutivo com a variante correta
- [ ] Pass: lint + typecheck; `detail.tsx` ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

### T4.2 — Alterar visibilidade, dizendo o que muda

#### Objective
O detalhe permite mudar a visibilidade, declarando quem passa a ver.

#### Why this step (action + reasoning)

**O que faz:** adiciona o controle de visibilidade consumindo `PUT .../visibility` da T0.2.

**Por que agora:** completa o critério de governança e usa o campo `visibility` que o eixo de API do
M31 acabou de expor na listagem — sem a tela, o campo é dado sem uso.

#### Evidence
- `.claude/knowledge-base/acceptance/M31-api-2026-08-04.md` §"Critério 1" — `visibility` chega na resposta e foi medido no app-dev.
- `packages/core/src/infrastructure/db/schema.ts` — `private` · `shared` · `public`, default `private`; a visibilidade "só aumenta por ação explícita".

#### Files to edit
```
../theo-cloud/dashboard/src/pages/skills/detail.tsx — controle de visibilidade
../theo-cloud/dashboard/src/pages/skills/detail.test.tsx — RED primeiro
../theo-cloud/dashboard/src/components/skills/skills-api.ts — setVisibility()
../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts — handler de visibility
```

#### Deep Dives
- **Aumentar visibilidade é ação de risco**, não destrutiva: `private → public` expõe a instrução a
  terceiros. Confirmação com declaração de quem passa a ver; **reduzir** não precisa da mesma
  cerimônia (não expõe ninguém).
- **Edge case:** valor não suportado pelo registry → recusa tipada repassada.
- **Edge case:** skill sem permissão de tornar pública → o texto do serviço nomeia o escopo faltante.

#### Tasks
1. Testes RED: aumentar pede confirmação com quem passa a ver; reduzir não exige frase; recusa mostra texto do serviço.
2. `setVisibility()` + handler MSW.
3. Implementar o controle.

#### TDD
```
RED:     aumentar_visibilidade_pede_confirmacao_declarando_quem_ve()
RED:     reduzir_visibilidade_nao_exige_frase_digitada()
RED:     recusa_do_servico_chega_com_o_texto_dele()
GREEN:   Implementar
REFACTOR: Nenhum esperado
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- detail
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Aumentar visibilidade declara o novo público antes de aplicar
- [ ] Recusa do serviço chega com o texto do serviço
- [ ] Pass: lint + typecheck; `detail.tsx` ≤ 500 linhas

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

## Phase 5: Navegação e a jornada inteira

**Objective:** garantir que nada do que foi construído seja alcançável só por URL, e provar a
jornada de ponta a ponta.

### T5.1 — As três peças da navegação

#### Objective
Playground e Nova skill entram no submenu **e** nas rotas, com `resolveActiveMenu` conferido.

#### Why this step (action + reasoning)

**O que faz:** declara as rotas em `app.tsx` (lazy import) e os itens no submenu `skills:` de
`app-sidebar-menus.ts`.

**Por que agora:** é o passo que o `CLAUDE.md` deste repo registra como o que ninguém lembra — no
`theo-trust` quatro telas ficaram alcançáveis só digitando a URL, e três rodadas de validação
passaram por cima disso.

#### Evidence
- `../theo-cloud/dashboard/src/components/layout/app-sidebar-menus.ts:264-275` — o submenu `skills:` tem **um** item (Overview).
- `../theo-cloud/dashboard/src/components/layout/app-sidebar-menus.ts:397-399` — `resolveActiveMenu` já trata `/skills` (a peça 3 já existe; verificado).
- `.claude/knowledge-base/audits/2026-08-03-skills-ux-journeys.md` §"Arquitetura de informação proposta".

#### Files to edit
```
../theo-cloud/dashboard/src/components/layout/app-sidebar-menus.ts — itens Playground e Nova skill
../theo-cloud/dashboard/src/app.tsx — rotas + lazy imports
../theo-cloud/dashboard/src/components/layout/app-sidebar-menus.test.ts — RED primeiro
```

#### Deep Dives
- **Critério de entrada no menu:** o próprio comentário do arquivo estabelece que só ações **de
  workspace** entram; detalhe e versões continuam por skill, alcançados da lista. Playground e Nova
  skill são de workspace — entram.
- **Edge case:** rota declarada sem item de menu = tela inalcançável; item sem rota = link morto. O
  teste cobre os dois sentidos.

#### Tasks
1. Teste RED: todo item do submenu `skills` tem rota correspondente, e vice-versa.
2. Adicionar itens ao submenu.
3. Adicionar rotas + lazy imports.

#### TDD
```
RED:     todo_item_do_submenu_skills_tem_rota()
RED:     toda_rota_de_skills_de_workspace_tem_item_no_submenu()
GREEN:   Implementar
REFACTOR: Nenhum esperado
VERIFY:  cd ../theo-cloud/dashboard && pnpm test -- app-sidebar-menus
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Playground e Nova skill aparecem no submenu e abrem
- [ ] Nenhuma rota nova sem item de menu; nenhum item sem rota
- [ ] Pass: lint + typecheck

#### DoD
- [ ] `pnpm test` verde
- [ ] CHANGELOG atualizado

---

### T5.2 — A jornada e2e por clique

#### Objective
Estender `skills-journey.spec.ts` para cobrir criar → validar → publicar → descobrir → excluir,
navegando **por clique a partir da raiz**.

#### Why this step (action + reasoning)

**O que faz:** escreve a jornada completa no e2e hermético, com os mocks registrados nas fases
anteriores.

**Por que agora:** é a métrica do Goal. Sem ela, "as jornadas funcionam" é afirmação, não medição.

#### Evidence
- `../theo-cloud/dashboard/e2e/skills-journey.spec.ts` (Baseline: 178 LoC, `c87a87a`) — jornada atual, só leitura.
- `../theo-cloud/dashboard/e2e/promptly-authoring-journey.spec.ts` — precedente de jornada de autoria no mesmo dashboard.

#### Files to edit
```
../theo-cloud/dashboard/e2e/skills-journey.spec.ts — jornada completa
../theo-cloud/dashboard/src/lib/mocks/skills-handlers.ts — completar o que faltar
```

#### Deep Dives
- **Regra inegociável:** navegação **por clique a partir da raiz**. Um passo alcançado por
  `page.goto('/skills/playground')` não prova navegação — é exatamente o furo que o `theo-trust`
  deixou passar três vezes.
- **Edge case:** a jornada precisa cobrir também o caminho de erro (validação reprovada), não só o
  feliz — `rules/testing.md` §4.1 (caso negativo ≠ edge case).

#### Tasks
1. Escrever a jornada por clique cobrindo os cinco passos.
2. Adicionar o caminho negativo (validação reprovada e recuperada).
3. Completar handlers MSW que faltarem.

#### TDD
```
RED:     jornada_completa_por_clique() — raiz → Skills → Nova skill → validar → publicar → playground → detalhe → excluir
RED:     jornada_com_validacao_reprovada_se_recupera() — erro posicionado, correção, publicação
GREEN:   Ajustar telas/mocks até passar
REFACTOR: Extrair helpers de navegação se o spec passar de 400 linhas
VERIFY:  cd ../theo-cloud/dashboard && pnpm test:e2e -- skills-journey
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] A jornada completa passa navegando só por clique
- [ ] O caminho negativo está coberto
- [ ] Nenhum `page.goto` para telas internas da jornada
- [ ] Pass: lint + typecheck

#### DoD
- [ ] e2e verde
- [ ] CHANGELOG atualizado

---

## Coverage Matrix

| # | Gap / Requirement (DoD do M31) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Nenhuma tela morta: ação, `EmptyState` com CTA in-app, erro com Retry, breadcrumb com volta | T1.1, T1.2 | Ações no `PageShell`, `EmptyState` de 4 elementos, erro de 6 elementos, breadcrumb nas duas rotas aninhadas |
| 2 | Descoberta observável: score **e** qual perna casou | T0.1, T2.1, T2.2 | Proxy de `:retrieve`, projeção pura com rótulo textual, tela do playground |
| 3 | Autoria sem publicar às cegas: validar sem efeito, erro por `field`/`line`, publicar acompanhando, sucesso oferece testar descoberta | T0.3, T3.1, T3.2 | Proxies de `:validate`/operação, validação-subconjunto no cliente, tela de autoria |
| 4 | Governança com coreografia: excluir e visibilidade sob §2.2 | T0.2, T4.1, T4.2 | Rotas de escrita, `DangerZone` com frase digitada, visibilidade com declaração de público |
| 5 | O acervo aguenta escala: busca e paginação com `next_page_token` | T1.3 | Paginação real + busca, testadas com acervo > 100 |
| 6 | O contrato de leitura sustenta as telas (`visibility` + `embedded`) | — (já entregue) | Eixo de API do M31, aceito em `.claude/knowledge-base/acceptance/M31-api-2026-08-04.md`; **consumido** por T1.3 e T4.2 |
| 7 | Toda tela alcançável por clique (regra do `CLAUDE.md`) | T5.1, T5.2 | Três peças da navegação + jornada e2e por clique |

**Coverage: 7/7 requisitos cobertos (100%)**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] Testes verdes — `cd ../theo-cloud/dashboard && pnpm test` e `cd ../theo-cloud && go test ./internal/...`
- [ ] Zero erros de tipo — `pnpm typecheck`
- [ ] Zero avisos de lint — `pnpm lint` e `golangci-lint run`
- [ ] Orçamento de tamanho respeitado (≤ 500 linhas por arquivo, `rules/architecture.md`)
- [ ] `CHANGELOG.md` **deste** repositório atualizado sob `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade preservada: nenhuma mudança no contrato público do registry (este plano só consome)
- [ ] Nenhuma tela nova alcançável apenas por URL — verificado por clique
- [ ] Q1, Q2 e Q3 respondidas com citação, não por suposição
- [ ] **Prova de comportamento em execução** — a jornada e2e exercita as rotas novas do BFF; rota que nenhum teste exercita não conta como entregue
- [ ] **Plano arquivado** — após `/review` retornar `READY_TO_MERGE` e o PR ser mergeado, mover para `knowledge-base/plans/completed/`

## Failure scenarios

O BFF fala com o registry por HTTP. Cada rota nova é uma dependência externa nova.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| registry `:retrieve` (HTTP) | 5xx do registry | httptest devolvendo 503 no `data_client` | O BFF repassa como erro; a tela mostra erro de 6 elementos com Retry — nunca lista vazia sugerindo "nada encontrado" |
| registry `:retrieve` (HTTP) | timeout de conexão | servidor de teste que não responde dentro do deadline | Erro acionável na tela dentro do limite; sem spinner infinito |
| registry `:validate` (HTTP) | 422 com `field`/`line` | httptest devolvendo o corpo tipado | Campos chegam intactos e a tela posiciona o erro na linha |
| registry `POST /v1/skills` (HTTP) | 409 nome já existe | httptest devolvendo 409 | Erro do servidor prevalece; a tela não afirma "validado" (D4) |
| registry `operations/:id` (HTTP) | operação nunca sai de estado intermediário | mock que responde sempre "em curso" | A tela para de esperar no limite e oferece ação, em vez de girar para sempre |
| registry `DELETE /v1/skills/:id` (HTTP) | 403 sem escopo | httptest devolvendo 403 tipado | Texto do serviço chega ao operador nomeando o escopo faltante |
| registry `PUT .../visibility` (HTTP) | 422 valor não suportado | httptest devolvendo 422 | Recusa tipada repassada, sem paráfrase nossa |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validar que as jornadas funcionam num fluxo real, não só em unidades isoladas.

### Execution

```
cd ../theo-cloud && go test ./internal/...              # BFF
cd ../theo-cloud/dashboard && pnpm test                 # unit + componente
cd ../theo-cloud/dashboard && pnpm typecheck            # zero erros de tipo
cd ../theo-cloud/dashboard && pnpm lint                 # zero avisos
cd ../theo-cloud/dashboard && pnpm test:e2e             # jornadas
```

Cenários de falha (a tabela acima) rodam junto da suíte Go, via `httptest`.

### Acceptance Criteria

- [ ] Todas as suítes verdes (Go + unit + e2e)
- [ ] Cobertura ≥ 90% nos arquivos alterados; **100%** em `retrieve-projection.ts` e `skill-draft.ts` (caminhos críticos: governam o que a tela afirma)
- [ ] Zero erros de tipo e zero avisos de lint
- [ ] Toda linha da tabela `## Failure scenarios` exercitada com o comportamento esperado observado
- [ ] A jornada e2e navega **só por clique**

### If Validation Fails

1. Separar falhas causadas por este plano das pré-existentes
2. Corrigir todas as causadas por este plano
3. Re-rodar a cadeia
4. Pré-existentes são registradas na descrição do PR e não bloqueiam

---

## Nota de encerramento — o que este plano deliberadamente NÃO faz

- **Desativar/deprecar skill** — o domínio só tem `ACTIVE` e `DELETED`. Construir a tela de um
  estado inexistente seria fabricação (D5). É trabalho de M32, junto com evals de qualidade.
- **Bundles e adoção** — capacidade inteira (M20/M21) sem tela alguma. A auditoria de origem
  registra e não propõe resolver aqui; merece plano próprio.
- **Editar o `SKILL.md` de uma revisão existente** — revisões são imutáveis por design; "editar" no
  registro significa publicar nova revisão, que é a jornada de autoria. A tela deve dizer isso em
  vez de oferecer um botão "Editar" que mente sobre a semântica.
