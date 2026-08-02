---
slug: m29-dashboard-ui
milestone_id: M29
target_project: theo-cloud
date: 2026-08-02
fase: DISCOVER
---

# M29 — DISCOVER: a interface do registro

## 1. O que JÁ EXISTE (medido, não suposto) — muda o escopo

| camada | estado | evidência |
|---|---|---|
| broker Model B + admin client | **JÁ EXISTE** | `theo-cloud/internal/skills/{broker,admin_client}.go` + testes |
| `SKILLS_BASE_URL` no arranque | **JÁ LIGADO** | `cmd/main.go:590,598,602` — `skills.NewAdminClient` + `skills.NewBroker` |
| escopos emitíveis | **JÁ DEFINIDOS** | `internal/routes/api_keys.go:71-73` — `skills:read/write/publish` |
| **rotas de dashboard** | **NÃO EXISTE** | `internal/routes/` não tem `skills_dashboard.go` |
| **telas** | **NÃO EXISTE** | `dashboard/src/pages/` tem `trust/` e `trust.tsx`, nada de skills |
| **menu** | **NÃO EXISTE** | a entrada "Skills" aponta para `/memory/skills` (outro produto) |

**Consequência:** o M29 é MENOR do que o milestone descreve. A metade de infraestrutura
(broker por inquilino, cunhagem de chave, config) está pronta. Falta o BFF de leitura e a UI.

## 2. As três peças do menu — e a armadilha DOCUMENTADA

`dashboard/src/components/layout/app-sidebar-menus.ts`:

1. `:120` entrada em Capabilities — `{ label, path, icon, drillsInto: 'trust' }`
2. `:230` objeto do submenu — `trust: { id: 'trust', ... }`
3. `:335` **`if (pathname.startsWith('/trust')) return { id: 'trust' };`**

**ACHADO CRÍTICO:** a instrução no topo do arquivo (`:91`) diz
**"4. (Optional) Extend resolveActiveMenu()"** — marcada **OPCIONAL**.
A linha `:332` registra o custo: sem ela *"o submenu `trust` existia inteiro, com as quatro
telas, e NUNCA abria"*.

**A instrução que diz "opcional" é a que causou o defeito.** Corrigir esse texto é parte do
M29 — senão o próximo produto repete, e a DoD item 1 protege só este.

## 3. Requisitos NÃO funcionais que decorrem da arquitetura

- **Isolamento por inquilino** é do broker, não da tela: a chave é cunhada por tenant. A UI
  nunca recebe `workspaceId` como parâmetro — herda do principal.
- **Erro tipado do upstream** precisa atravessar. O `theo-trust` tem `upstream_error.go` para
  preservar `4xx` + corpo; `internal/skills/` **não tem equivalente** — sem ele um `422` do
  produto vira `502` genérico e o operador perde a razão da recusa.
- **Observabilidade:** o BFF de leitura deve logar `trace_id`; o produto já o propaga.

## 4. Riscos técnicos e gargalos

| risco | natureza | mitigação |
|---|---|---|
| `resolveActiveMenu` esquecido | **falha silenciosa** — telas funcionam, menu não abre | DoD item 1 + corrigir o "(Optional)" |
| erro tipado colapsado em 502 | operador perde a razão da recusa | portar `upstream_error.go` |
| listagem sem paginação | 37 rotas, acervo cresce | `next_page_token` já existe na API |
| promover canal sem impacto visível | **destrutivo que não parece** | `ConfirmDialog` + contagem de consumidores |

## 5. Ambiguidades a resolver ANTES do PLAN

1. **A contagem de consumidores do canal existe?** A DoD exige "quantos consumidores passam a
   receber outro conteúdo". Se a API não devolve isso, ou o texto muda, ou o produto ganha o
   campo — decisão de escopo. **NÃO MEDIDO.**
2. **`usetheo-ui` é pacote publicado ou diretório local?** O pedido cita "componentes
   usetheo-ui de forma correta". **NÃO MEDIDO.**
