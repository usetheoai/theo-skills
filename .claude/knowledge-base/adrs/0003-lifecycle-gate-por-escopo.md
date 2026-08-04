# ADR 0003 — O gate do ciclo de vida é por escopo, não por papel

**Status:** ACCEPTED
**Data:** 2026-08-04
**Milestone:** M32
**Contexto de descoberta:** construção da tela de depreciação (AC5)

## Contexto

`PUT /v1/skills/:id/lifecycle` nasceu com `requireRole('admin')`. A escolha parecia a mais
conservadora: depreciar retira uma skill de circulação, então exigir o papel mais alto do
workspace soava prudente.

Ao construir a tela, medi que ela **tornava a rota inalcançável pelo painel**.

`requireRole` resolve o papel consultando a tabela de **membros**, pelo `userId` do principal:

```
require-role.ts:32   if (principal.userId === null) return 403
require-role.ts:33   const role = await membersStoreFor(ws).roleOf(principal.userId)
require-role.ts:34   if (role === null || !roleSatisfies(role, min)) return 403
```

A credencial que o dashboard usa é cunhada pelo broker Model B em `/v1/platform/keys`, e essa
rota grava:

```
platform-keys.ts:22   const SYSTEM_USER_ID = 'sys_platform_gateway'
platform-keys.ts:94   userId: SYSTEM_USER_ID
```

O comentário ao lado explica por quê, e a razão é boa: *"usar um `user_id` humano qualquer
atribuiria a atividade do gateway a alguém que não a praticou."*

Consequência medida: `roleOf('sys_platform_gateway')` devolve `null`, o gate responde **403 a todo
pedido vindo da tela**, e o AC5 do M32 era impossível de construir. A capacidade existia no serviço
e nenhum consumidor a alcançava.

## Decisão

O gate passa a ser `requireScope('skills:publish')`.

## Rationale

**Papel e escopo respondem perguntas diferentes.** Papel responde *"quem é você dentro deste
workspace"* — a pergunta certa para administrar membros e cunhar chaves em nome de pessoas. Escopo
responde *"o que esta credencial pode fazer"* — a pergunta certa para curadoria do acervo.

Depreciar é curadoria. É a mesma família de `PUT /v1/skills/:id/channels/:channel`, que já exige
`skills:publish`.

**E a comparação com promover expõe a inversão.** Promover canal é declaradamente a operação mais
perigosa do produto: reaponta o canal e troca, **sem redeploy**, o conteúdo que os consumidores
resolvem. Depreciar não faz nada disso — a própria DoD deste milestone exige que a skill deprecada
**continue resolvível** para quem já a referencia; o que muda é a descoberta.

Exigir *mais* privilégio para o ato *menos* perigoso era a inversão. Corrigi-la não é afrouxar o
gate: é alinhá-lo ao eixo que o resto da família já usa.

## Alternativas rejeitadas

**A — Registrar `sys_platform_gateway` como membro admin do workspace.** Faria o `requireRole`
passar sem tocar na rota. Rejeitada porque destrói exatamente o que o usuário sintético existe para
proteger: a atribuição de auditoria. Toda ação do gateway passaria a ter um "membro" por trás, e a
distinção entre credencial de pessoa e credencial de gateway — que `platform-keys.ts:19-22` declara
de propósito — desapareceria do banco.

**B — Deixar a rota como está e não construir a tela.** Rejeitada: o AC5 é parte da DoD, e uma
capacidade que só existe por `curl` é a lacuna que o M32 e o M35 existem para fechar.

**C — Aceitar papel OU escopo (`requireRole('admin') || requireScope(...)`).** Rejeitada por KISS e
por honestidade do gate: duas portas para o mesmo cômodo tornam impossível responder "quem pode
depreciar?" sem ler o código. Uma regra, um eixo.

## Consequências

- Qualquer portador de `skills:publish` pode depreciar. **Isso é uma ampliação real**, e a declaro:
  antes, apenas membros com papel `admin`; agora, qualquer credencial com o escopo.
- Na prática, no dashboard, a diferença é pequena e já documentada: o `wiring` do theo-cloud declara
  que *"não há RBAC por usuário neste produto, então todo usuário autenticado do workspace recebe
  uma chave capaz de promover"*. Quem já podia promover — o ato mais perigoso — passa a poder
  depreciar, que é menos.
- A mitigação continua sendo a mesma do caminho de promoção: confirmação com frase digitada na tela.
- `membersStoreFor` saiu das dependências do handler; a rota não consulta mais a tabela de membros.

## Como está travado

`m32-lifecycle-reachable.integration.test.ts` assere os **dois** lados:

1. o principal de gateway (não-membro, com `skills:publish`) recebe **200**;
2. o mesmo principal com apenas `skills:read` recebe **403**.

A segunda metade não é redundância. Sem ela, remover o gate inteiro passaria no arquivo — e recusa
cega é indistinguível de segurança, do mesmo modo que aceitação cega é indistinguível de ausência
de gate. É o mesmo par que `write_client_test.go` usa no theo-cloud, pela mesma razão.

## Referências

- `packages/api/src/server/handlers/lifecycle.ts` — o gate e o porquê inline
- `packages/api/src/server/auth/require-role.ts:28-36` — a resolução por membro
- `packages/api/src/server/handlers/platform-keys.ts:19-22,94` — o usuário sintético
- `ROADMAP.md § M32` — AC5, o critério que a mudança destrava
