# ADR 0004 — A visibilidade fica fora da tela enquanto a identidade do usuário não atravessar o broker

**Status:** ACCEPTED
**Data:** 2026-08-04
**Milestone:** M31 (critério "Governança com coreografia")
**Contexto de descoberta:** tentativa de construir a tela de visibilidade

## Contexto

O M31 pede: *"Excluir e alterar visibilidade existem na tela sob o contrato do `DESIGN.md` §16."*

Ao construir, medi que `PUT /v1/skills/:id/visibility` usa `requireRole('admin')` — o mesmo gate
que tornava o ciclo de vida inalcançável pelo painel (ADR 0003). O reflexo era aplicar a mesma
correção: trocar papel por escopo.

**Fiz isso, e um teste existente reprovou** — corretamente:

```
m14-promotion.integration.test.ts:92
  'MEMBER não promove — curadoria é explícita, não auto-publicação'
```

## O que aquele teste protege, e por que não é o mesmo caso do ADR 0003

O teste monta os dois principals com **o mesmo escopo** (`skills:admin`) e discrimina **apenas
pelo papel** na tabela de membros. A regra que ele trava não é técnica: publicar uma skill como
`public` a expõe **além do workspace**, e a decisão de expor é de governança.

Isso é materialmente diferente de depreciar:

| | Depreciar (ADR 0003) | Publicar (aqui) |
|---|---|---|
| Alcance do efeito | interno ao workspace | **fora** dele |
| Quem é afetado | quem descobre no próprio acervo | terceiros |
| Reversível sem dano | sim | o conteúdo já foi visto |

Trocar o eixo para escopo apagaria a distinção — e o painel cunha a **mesma** credencial para todo
usuário autenticado. Na prática, todo membro passaria a publicar. É exatamente o que o teste
nomeia: auto-publicação.

## Decisão

**A visibilidade NÃO ganha tela neste milestone.** O gate `requireRole('admin')` permanece.

O critério do M31 fica parcialmente cumprido: **excluir** entra na tela (não tem regra de papel);
**alterar visibilidade** não.

## Alternativas rejeitadas

**A — Trocar para `requireScope`, como no ciclo de vida.** Rejeitada: apaga uma regra de
governança para fazer um critério passar. É o workaround que o pedido do milestone proíbe, e o
teste que a protege é anterior a este trabalho.

**B — Registrar `sys_platform_gateway` como membro admin.** Rejeitada pelo mesmo motivo do ADR
0003 — destrói a atribuição de auditoria — e agrava: aqui a atribuição é gravada em
`published_by`, e passaria a dizer que o gateway publicou.

**C — Criar `skills:curate`, um escopo que só admins recebem.** Rejeitada porque não resolve: o
broker cunha a chave a partir do JWT do workspace, e **não consulta o papel do usuário**. O escopo
novo seria concedido a todos ou a ninguém.

## O caminho correto, e por que não é agora

O que falta é o broker **propagar a identidade do usuário** — cunhar chave por (tenant, usuário) em
vez de por tenant, ou o registro aceitar um cabeçalho de ator assinado pelo plano de controle.

Isso é mudança arquitetural do Model B, não um ajuste de gate: mexe em cache de chaves, em
atribuição de auditoria e na superfície de confiança entre control plane e data plane. Merece
milestone próprio, com discovery.

Fazê-lo por dentro deste milestone, sob pressão de um checkbox, é como se introduz um furo de
governança.

## Consequências

- O critério "Governança com coreografia" do M31 fica **parcialmente** cumprido, e a aceitação deve
  registrar isso como `not_exercised` para a metade de visibilidade — nunca `passed`.
- `published_by` continua significando uma pessoa real.
- A tela exibe a visibilidade atual (leitura), e **não oferece** o controle de alteração: um botão
  que responde 403 sempre é pior que a ausência dele — ensina o operador a desconfiar da interface.

## Referências

- `packages/api/tests/integration/m14-promotion.integration.test.ts:92` — o teste que reprovou
- `packages/api/src/server/handlers/visibility.ts` — o gate mantido
- ADR `0003-lifecycle-gate-por-escopo` — o caso em que a troca de eixo **era** correta
- `cmd/skills_dashboard_wiring.go` (theo-cloud) — *"não há RBAC por usuário neste produto"*
