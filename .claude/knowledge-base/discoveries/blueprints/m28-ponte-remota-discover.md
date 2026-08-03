---
slug: m28-ponte-remota
milestone_id: M28
target_project: theo-skills
date: 2026-08-03
fase: DISCOVER
---

# M28 — DISCOVER: a ponte não é estrutural, é configuração ausente

## A premissa do milestone está errada

O M28 diz que a ponte remota *"não existe, e a razão é estrutural — não é configuração faltando"*.
**Medido, é o contrário:** as duas pontas existem e nunca foram ligadas.

| ponta | estado |
|---|---|
| nossa — servidor MCP HTTP por inquilino | **construído** (M25 `[x]`), isolamento provado por sessão |
| a outra — `usetheo-labs/agent-builder` | **existe em disco**, declara `@theokit/sdk` |
| o SDK | **suporta servidores MCP** (skill `theokit-sdk` deste ambiente) |
| o elo | `agent-builder`: **zero** `mcp` em `src/`, **zero** menções a `theo-skills` |

## Estado de execução hoje (2026-08-03)

```
docker ps | grep mcp   -> theo-workspace-theo-mcp-gateway-1  (do theo-workspace)
curl 127.0.0.1:18097   -> 000   (theoskill_mcp NÃO está no ar)
curl 127.0.0.1:8080    -> 000
```

O ouvinte do `theo-skills` precisa ser levantado antes de qualquer exercício do bullet 2.

## Bullet 1 — JÁ ENTREGUE

`adrs/0003-onde-vive-a-ponte-theokit.md`, com as três opções e a medição. A terceira (MCP, já
construído) provavelmente torna as outras duas desnecessárias — mas o ADR está `proposed`, não
`accepted`, porque a escolha envolve o dono do outro produto.

## O que trava o bullet 2 — decisão pedida ao dono

Exige um agente Theokit **real** descobrindo skill que não conhecia. Isso é trabalho em
`usetheo-labs/agent-builder` — **outro repositório, fora do escopo `theo-skills`**.

Diferente do M7: ali o bloqueio era credencial + calendário. Aqui é **permissão de escopo**, e é
pequeno: configurar um servidor MCP num agente que já fala o protocolo.

**Pergunta feita ao dono, aguardando:** posso escrever no `usetheo-labs/agent-builder`?
- **Sim** → M28 é integração + evidência, fechável.
- **Não** → M28 para onde o M7 parou, e vale saber agora.

## Bullet 3 destrava o M7

Tirar o cenário-âncora de `partial` é o que alimenta as evidências de dogfood que o M7 espera.
Os dois milestones estão acoplados por esse bullet.

## MEDIÇÃO — nossa metade da ponte SUBIU (2026-08-03)

```
$ node packages/mcp/dist/bin.js --transport streamable-http
  theo-skills mcp: ouvindo em http://127.0.0.1:18097 → http://127.0.0.1:18740
$ curl :18097/                       -> 400   (handshake MCP exigido, não GET raso)
```

O ouvinte **do build** está no ar, apontando para a API que serviu a aceitação do M30. Antes
desta sessão ele não estava (`curl → 000`), e eu quase reportei "ponte inexistente" quando o que
faltava era ligá-lo.

**Consequência para o M28:** nossa metade está viva e alcançável. O que resta do bullet 2 é
configurar o `agent-builder` para falar com este endereço — trabalho de um arquivo de config, em
outro repositório. Confirma o diagnóstico: **configuração ausente, não lacuna estrutural.**
