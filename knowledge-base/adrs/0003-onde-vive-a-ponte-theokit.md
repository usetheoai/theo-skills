---
adr: 0003
title: Onde vive a ponte de descoberta em runtime entre theo-skills e Theokit
status: proposed
date: 2026-08-03
milestone: M28
decisores: dono do theo-skills + dono do Theokit (a decisão atravessa dois produtos)
---

# ADR 0003 — Onde vive a ponte

## Contexto

O M28 pede que um agente Theokit real descubra uma skill que **não conhecia** e carregue o corpo
dela do registry **sem passar pelo disco**. O caminho de disco já funciona e não é o objeto:
`theoskill install` materializa em `.theokit/skills/` e o agent-builder carrega dali (evidência de
2026-07-31).

O que existe **do nosso lado**, medido em 2026-08-03:

| peça | estado |
|---|---|
| `createRemoteSkillsManager` — `retrieve` por intenção, cache, fallback que se anuncia | `packages/sdk/src/remote-skills-manager.ts`, exportado, testado |
| `toTheokit` → `CreateSkillSpec` do SDK 4.36.0 | provado contra `Skill.create` real |
| MCP HTTP por inquilino, no ar | M25 `[x]`, isolamento medido |

**O que falta não é código nosso: é um consumidor do outro lado.**

## Decisão a tomar

**(i) Provider no Theokit** — o Theokit ganha um provider que consome `@usetheo/skills-sdk`.

- ✅ A ponte fica onde o consumo acontece; nosso SDK já expõe exatamente a superfície necessária.
- ✅ O fallback já é nosso e já se anuncia como fallback.
- ❌ Exige mudança **no Theokit** — não controlamos o repo, o release, nem a cadência.
- ❌ Acopla o Theokit ao nosso SDK (versão, breaking changes).

**(ii) Adaptador aqui** — materializamos a skill no layout que o Theokit já lê.

- ✅ Não exige mudança no outro produto — usa o carregador que ele já tem.
- ✅ Cadência sob nosso controle.
- ❌ **Passa pelo disco**, que é exatamente o que o M28 quer evitar. Entregaria a forma sem a
  propriedade — e um marco fechado assim mente.
- ❌ Duplica no adaptador a lógica de cache/fallback que já vive no SDK.

**(iii) MCP como a ponte** — o agente descobre por `search_skills`/`load_skill` via o servidor MCP
que o M25 já pôs no ar, sem SDK nem disco.

- ✅ **Já está no ar**, com isolamento por inquilino medido por sessão.
- ✅ Zero mudança no Theokit se ele já fala MCP.
- ❓ **Não medido:** o `agent-builder` consome MCP? Com que transporte? É a pergunta que decide.

## Por que isto não é decidido aqui

A opção (iii) pode tornar a (i) desnecessária e a (ii) indesejável — e ela depende de um fato que
eu **não medi**: se o `agent-builder` fala MCP. O Theokit não está neste workspace (há o
`theokit-app`, fixture de 1 arquivo, e o pacote npm `@theokit/sdk`).

**Escrever código antes desse fato é o erro que o próprio M28 nomeia** ao pedir "ADR, não código
primeiro".

## Medição de 2026-08-03 — a opção (iii) ganhou força, e o alvo mudou de lugar

**(a) O `@theokit/sdk` suporta MCP.** O skill `theokit-sdk` registrado neste ambiente descreve o
SDK como cobrindo *"Agent.create / Agent.prompt, Tool.create with Zod, streaming SDKMessage
events, run.wait/cancel, **MCP servers**, subagents, cron jobs, memory/context/skills"*. Se o
agente aceita servidor MCP, o servidor do M25 — **já no ar, com isolamento por inquilino medido
por sessão** — é a ponte, e nada precisa ser construído aqui.

> Força honesta desta evidência: é **documentação do SDK**, não execução do `agent-builder`.
> Basta para tornar (iii) a hipótese principal; não basta para fechar o bullet 2 do M28, que
> exige um agente real descobrindo uma skill que não conhecia.

**(b) O `agent-builder` NÃO está neste workspace** — vive em `usetheo-labs/agent-builder`. A
verificação de ponta a ponta **não é executável daqui**: exige aquele repositório, com o servidor
MCP do M25 configurado e uma chave cunhada por inquilino.

**Consequência para o M28:** o marco provavelmente deixa de ser *construção* e vira *integração +
evidência* — configurar o `agent-builder` contra o ouvinte que já existe e registrar a execução.
Isso muda o esforço, o risco e quem precisa estar na sala.

## Próximo passo (mede, não decide)

1. **No repo `usetheo-labs/agent-builder`** (não aqui): configurar o servidor MCP do M25 como
   fonte de skills e verificar se o agente descobre uma skill que não conhecia. Transporte HTTP,
   bearer cunhado por inquilino — o ouvinte já recusa `401` sem ele.
2. Se funcionar → (iii). O M28 vira integração + evidência; (i) fica desnecessária e (ii),
   indesejável (ela passa pelo disco, que é o que o marco quer evitar).
3. Se não funcionar → escolher entre (i) e (ii) **com o dono do Theokit**, não sozinho.

## Consequência de não decidir

O M28 fica aberto e **bloqueia o cenário-âncora do dogfood**, que por sua vez bloqueia o
`status: running` do M7 — o critério de ship do V1. A dívida não é de código; é de uma conversa
entre dois donos.
