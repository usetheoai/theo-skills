# CLAUDE.md — theo-skills

The **theo-skills** module of the Theo platform.

## A interface desta capacidade se constrói no dashboard do theo-cloud

Este repositório **não tem e não deve ganhar frontend próprio** — nem mesmo um painel de
desenvolvimento que "só a gente usa". Quando o `theo-skills` precisar de tela — navegar o registro,
ver as versões de uma skill, inspecionar o que a busca semântica devolveu, publicar — ela nasce em
`theo-cloud/dashboard`, como uma capacidade do ecossistema, exatamente como o `theo-trust` fez.

Um frontend aqui dentro significaria: outro build, outro deploy, outra sessão, outro design system
e um segundo lugar onde o operador precisa aprender a navegar. O ecossistema tem UMA porta —
`app-dev.usetheo.dev` — e é por ela que o cliente entra. (O `prototype/` deste repo é estudo, não
produto: nada dali vira a interface do cliente.)

**O `theo-trust` é a implementação de referência. Copie o caminho dele.**

### As peças, e onde cada uma vive

Nada disto fica neste repo. Tudo em `theo-cloud/`:

| Peça | Caminho (trocando `trust` → `skills`) | O que é |
|---|---|---|
| Cliente do serviço + broker | `internal/trust/{data_client,write_client,broker}.go` | fala com este serviço; o broker cunha a chave **por tenant** (Model B) com o escopo mínimo |
| Erro tipado do upstream | `internal/trust/upstream_error.go` | preserva `4xx` + corpo — sem isto, um `422` do serviço vira `502` genérico e o operador perde a razão da recusa |
| Rotas do BFF | `internal/routes/trust_dashboard.go`, `trust_guardrails.go` | `GET/POST/DELETE /v1/dashboard/skills/*` |
| Composição | `cmd/trust_dashboard_wiring.go` | onde as peças se ligam |
| Telas | `dashboard/src/pages/trust.tsx`, `dashboard/src/pages/trust/*.tsx` | uma tela por arquivo |
| Lógica pura | `dashboard/src/components/trust/*.ts` | projeções e validação **fora do React**, testadas sem browser |
| Mocks | `dashboard/src/lib/mocks/trust-handlers.ts` | sem eles a tela não entra no e2e hermético |
| Jornada e2e | `dashboard/e2e/guardrails-journey.spec.ts` | um e2e da jornada inteira, não um por tela |

Contrato de design da tela: `theo-cloud/dashboard/DESIGN.md` (18 seções — 5Q-3s, estados vazios,
erros como diagnóstico, tabelas para decisão, danger zone). Leia antes de desenhar, não depois.

### A navegação tem DUAS metades — e esquecer uma custa o milestone inteiro

Em `dashboard/src/components/layout/app-sidebar-menus.ts`:

1. a entrada em `Capabilities` com `drillsInto: 'skills'`;
2. o objeto `skills:` com as telas do submenu;
3. **a linha em `resolveActiveMenu`**: `if (pathname.startsWith('/skills')) return { id: 'skills' };`

E em `dashboard/src/app.tsx`: o lazy import e o `<Route>`.

O item 3 é o que ninguém lembra. No `theo-trust` o submenu foi declarado completo, com as quatro
telas — e **nunca abriu**, porque a linha de resolução não existia. Quatro telas ficaram
alcançáveis só digitando a URL, e três rodadas de validação passaram por cima disso: eu validava
abrindo a URL, que é o único caminho que o usuário real não tem.

**Valide navegando pelo menu, a partir da raiz.** Se você chegou na tela digitando o endereço,
você não testou a navegação.

### O que ESTE repositório decide sobre a UX

A tela não pode mostrar o que o serviço não manda. Estes três defeitos são de backend e chegaram
ao usuário como defeitos de interface:

- **Campo que a jornada exige, ausente na resposta.** O `/policy-violations` do `theo-trust` não
  devolve `conversationId`; a tela promete "abra para ver a conversa de origem", o botão nunca
  aparece e o painel de detalhe virou código morto em produção. Ao desenhar um endpoint, pergunte
  qual é a **próxima ação** de quem lê aquela lista, e devolva o que a torna possível — aqui, uma
  lista de skills sem a versão vigente e sem o identificador que abre o detalhe é uma lista que só
  serve para olhar.
- **Mensagem de erro escrita para o terminal.** Um `401` com `"Not authenticated. Run: theo login"`
  instrui a rodar um comando de CLI para quem está num navegador. Este repo tem CLI **e** vai ter
  tela: erro tipado é contrato — `code` estável para a máquina decidir, `message` legível por um
  humano que **não sabe** que existe CLI.
- **O mesmo dado em dois formatos.** No catálogo de validators, `kind` vem no topo para regras de
  plataforma e dentro de `spec` para as do tenant — a coluna "Tipo" ficou vazia exatamente nas
  linhas que o operador tinha criado. Um campo, um lugar; e se a origem (plataforma vs workspace)
  muda a forma, a tela vai errar na origem que menos se testa.

### Antes de dizer que a capacidade está pronta

- [ ] Cheguei em cada tela **clicando**, a partir da raiz — nunca digitando a URL.
- [ ] Existe caminho de **volta**: todo formulário tem saída explícita (o item do menu leva ao overview, não ao ponto de origem).
- [ ] Ação destrutiva usa o `ConfirmDialog` canônico com frase digitada, e o texto diz **o que deixa de valer**, não "o item será removido".
- [ ] Falha de leitura não é renderizada como "não há nada" — são estados diferentes e a diferença é a que importa.
- [ ] Mensagem tipada do serviço chega à tela; o texto genérico é só o fallback.
- [ ] Lógica de projeção/validação testada **fora** do React.
- [ ] Handlers de mock registrados, e a jornada coberta por um e2e.

> Ponteiro de integração de plataforma abaixo; regras/contrato específicos do módulo vão acima
> desta linha conforme ele amadurece.

## Integrating with the Theo platform (local live-test)

This is a module of the Theo platform. To develop it against the **live platform** and — if it
exposes an HTTP API — wire it into the unified edge as a capability (the way `theo-memory` is
`/v1/memory`), use the local-env umbrella in **theo-workspace**.

**Start here → `theo-workspace/docs/README.md`**
(repo `usetheodev/theo-workspace`; local sibling: `../../theo-cloud/theo-workspace`).

Read in order:

1. `docs/local-env-system-design.md` — where this module fits (a data-plane capability behind the Traefik edge; the engine is k8s-native and lives in the cloud).
2. `docs/ONBOARDING.md` — `make up-local` + `make memory-up` to bring the platform up and live-test in the browser. Per-role workflows + troubleshooting.
3. `docs/adding-a-microservice.md` — expose this module at the edge: **Level 1** (edge route, ~10 min, theo-workspace only) → **Level 2** (per-tenant Model B isolation, across theo-workspace + theo-cloud + this module's auth contract). **theo-memory is the reference implementation — copy it.**

Honest notes from the live validation (2026-06-25/26): run the control-plane with `make up-local`
(GHCR `:develop` is behind the current source); the LLM/provider is always the **real** API (no
mock); after editing `theo-workspace/dev/traefik/dynamic.yml` recreate traefik (single-file bind
mount + `watch:true` misses inode changes).
