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

## Próximo passo (mede, não decide)

1. O `agent-builder` suporta servidor MCP? Qual transporte?
2. Se sim → (iii), e o M28 vira integração + evidência, não construção.
3. Se não → escolher entre (i) e (ii) **com o dono do Theokit**, não sozinho.

## Consequência de não decidir

O M28 fica aberto e **bloqueia o cenário-âncora do dogfood**, que por sua vez bloqueia o
`status: running` do M7 — o critério de ship do V1. A dívida não é de código; é de uma conversa
entre dois donos.
