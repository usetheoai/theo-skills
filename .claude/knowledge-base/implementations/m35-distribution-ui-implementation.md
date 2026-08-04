---
slug: m35-distribution-ui
target_project: theo-cloud
milestone_id: M35
created_at: 2026-08-04
goal: Dar tela à distribuição de skills, fechando os 4 critérios da DoD do M35 que a aceitação marcou como não exercitados
---

# M35 — o eixo de tela: a distribuição de skills ganha interface

## Por que este trabalho existe

A aceitação do M35 (`acceptance/M35-2026-08-04.md`) computou **`NOT_VALIDATED`**: 1 critério
`passed` e 4 `not_exercised`, todos de tela. O `theo-skills` não hospeda frontend por contrato —
a interface nasce em `theo-cloud/dashboard`, como o `theo-trust` fez.

Este documento registra o trabalho feito **no `theo-cloud`**, porque é aqui que os artefatos de
ciclo vivem.

## O que foi entregue

| Camada | Arquivo (em `theo-cloud`) |
|---|---|
| Cliente por tenant (Model B) | `internal/skills/distribution_client.go` |
| Rotas BFF | `internal/routes/skills_distribution.go` |
| Composition root | `cmd/main.go` |
| Projeções (fora do React) | `dashboard/src/components/skills/distribution.ts` |
| Telas | `dashboard/src/pages/skills/{bundles,bundle-detail}.tsx` |
| Navegação | `app-sidebar-menus.ts` (3 peças) + `app.tsx` (2 rotas) |
| Mocks | `dashboard/src/lib/mocks/skills-handlers.ts` |
| e2e | `dashboard/e2e/skills-journey.spec.ts` |

PR: `usetheoai/theo-cloud#413`.

## A rota que era o milestone inteiro

```
POST   /v1/bundles/:id/tokens             → token (uma vez)
GET    /v1/bundles/:id/tokens             → revela o token_id     ← a peça que faltava
DELETE /v1/bundles/:id/tokens/:tokenId    → revoga com esse id
```

Sem a do meio, o `DELETE` exigia um identificador que a tela não tinha como descobrir — e um
token emitido pela CLI ou por outro operador era invisível, logo irrevogável.

## Achado de segurança, corrigido no serviço

`GET /v1/bundles/:id/adoption` era a **única rota da família sem gate de escopo**. As outras cinco
exigem `skills:publish`; esta só verificava a existência de um principal.

Consequência medida: um portador de `skills:read` — o escopo que o dashboard cunha para o cliente
de leitura, e o que um agente consumidor carrega — lia a telemetria comercial de quem publica.
Mesmo workspace, então não é vazamento entre inquilinos; é privilégio a mais dentro dele.

Corrigido em `theo-skills` com teste que **também** assere o 403 já existente nos tokens — a
segunda metade importa: sem ela, um gate que recusasse tudo passaria no teste.

## Três defeitos evitados por precedente, não por sorte

### 1. O subtree que sombreia (chi)

`r.Route` cria subtree e **sombreia** rotas do pai. Em 2026-08-02 isso derrubou
`GET /{skillID}/channels` em produção, devolvendo `404 page not found` em texto puro.

Pendurar bundles sob `/v1/dashboard/skills/...` reproduziria a classe por outra via: o chi
trataria `bundles` como um `{skillID}`, e a precedência entre rota estática e parâmetro passaria
a depender da ordem de registro.

**Decisão:** recurso irmão — `/v1/dashboard/bundles`. Travado por
`TestDistribuicao_naoSombreiaAsRotasDeSkills`, que monta as duas famílias no **mesmo roteador** —
a interação que só existia no `main.go` quando a regressão passou.

### 2. A terceira metade da navegação

O `theo-trust` declarou o submenu completo e ele **nunca abriu**: faltava a linha em
`resolveActiveMenu`. Quatro telas ficaram alcançáveis só digitando a URL, e três rodadas de
validação passaram por cima — porque validavam digitando o endereço, que é o único caminho que o
usuário real não tem.

`/bundles` não começa com `/skills`, então precisa de linha própria. **Provado discriminante:**
removida a linha, o e2e da jornada reprova (medido, com o arquivo restaurado íntegro depois).

### 3. O rótulo que faria a tela mentir

O ROADMAP pedia que a tela dissesse que a adoção **"é por bundle, não por skill"**.
`adoption-store.ts:7-19` mede **por skill+versão**, escopado ao bundle.

A tela diz a granularidade medida. O que de fato não existe é agregação **entre** bundles.

## Decisões de projeção que evitam a tela mentir

| Decisão | Por quê |
|---|---|
| Revogado **vence** expirado | Exibir "expirado" esconderia que alguém cortou de propósito — ações diferentes |
| `expires_at === agora` já é expirado | O serviço já recusa; tratar como ativo faria a tela discordar do backend |
| Data ilegível → `unknown`, não um estado afirmativo | Chamar de ativo exibiria como utilizável o que não se sabe ler; de expirado cortaria o que ainda vale |
| `share` usa `total_installs`, nunca a soma das linhas | Sob paginação a soma é de um recorte; a proporção sairia inflada **em silêncio** |
| Sem denominador → `—`, não `0%` | `0%` afirma "ninguém instalou"; `—` admite "não dá para calcular" |
| Rótulo ausente → "sem rótulo" | Célula em branco parece dado faltando, e o operador procura um defeito que não existe |
| Token revogado não oferece botão | Um controle que não faz nada ensina a desconfiar da tela |

## Correção de percurso declarada

Um teste do cliente Go afirmava que `url.PathEscape` não impedia travessia de caminho. **Estava
errado, e quase reportei um defeito de segurança inexistente.** Medido:

```
PathEscape("../../v1/skills") = "..%2F..%2Fv1%2Fskills"
req.URL.String()              = ".../v1/bundles/..%2F..%2Fv1%2Fskills/tokens"   ← transmite escapado
r.URL.Path (no servidor)      = "/v1/bundles/../../v1/skills/tokens"            ← já decodificado
```

O escape funciona. Meu teste inspecionava `r.URL.Path` — o que o **receptor** entendeu — em vez de
`EscapedPath()`, o que o cliente **transmitiu**. Corrigi o teste, não o código.

## Gates medidos

| Gate | Resultado |
|---|---|
| `go build ./...` | OK |
| `go test ./internal/routes ./internal/skills ./cmd` | pass |
| `npm run typecheck` | 0 erros |
| `npm run lint` (arquivos deste trabalho) | 0 problemas |
| `npm test` | **2432 passed** / 286 arquivos |
| e2e M35 (chromium, serial) | **3/3** |
| Projeções (unit) | 15/15 |

## Limite declarado, sem maquiar

A suíte e2e completa (24 testes × 4 browsers) tem falhas sob paralelismo **nesta máquina**,
incluindo testes M26 **pré-existentes**. Isolados, passam. O próprio arquivo já documentava essa
flakiness sob carga desde 2026-08-02.

Não afirmo ter resolvido isso. Afirmo que meus três testes passam em execução serial e que os
pré-existentes falham igualmente com e sem o meu diff — medido nas duas condições.

## O que ainda falta para o M35 fechar

Re-rodar `/acceptance M35` contra `app-dev.usetheo.dev` **depois** que este PR for mergeado e
implantado. Só então os 4 critérios de tela passam a ser exercitáveis, e o verdict é computado —
nunca afirmado.

Issue de rastreio: `usetheoai/theo-skills#139`.
