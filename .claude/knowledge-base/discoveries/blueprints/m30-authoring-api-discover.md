---
slug: m30-authoring-api
milestone_id: M30
target_project: theo-skills
date: 2026-08-03
fase: DISCOVER
---

# M30 — DISCOVER: a API da autoria

## 1. O caminho compartilhado do AC1 JÁ É a arquitetura

`ingestPayload` (`packages/api/src/server/handlers/skills.ts:72`) é privada do módulo e já serve
as **duas** rotas de escrita: `POST` (`:203`) e `PATCH` (`:273`). Ela delega a
`validateSkillPayload`, o *core checker* compartilhado, com o comentário explícito:

> *"delegates to the SHARED core checker so the server and the dev CLI never diverge (M5 DRY)"*

**Consequência:** o `:validate` no mesmo arquivo compartilha por construção. O AC1 não pede
refatoração — pede que a rota nova não crie um segundo caminho. O teste que discrimina é o
tabular sobre payloads inválidos: mesma entrada, mesmo `code` nas duas rotas.

## 2. A forma do erro NÃO atende o AC4 hoje — e essa é a maior parte do trabalho

Medido:

```
ingestPayload:  throw new BoundaryError(400, result.code)
fail():         return c.json({ error: err.code }, err.status)
```

A resposta é **`{ error: "<code>" }`** — sem `message`, sem campo, sem linha. O AC4 exige
*"campo e linha, além de `{code, message}`"*.

Duas consequências que o plano precisa encarar:

- **Mudar a forma do erro é mudança de contrato** para quem já consome `POST /v1/skills`. Ou o
  `:validate` responde num formato mais rico que as rotas de escrita (divergência que o AC1
  combate), ou as três mudam juntas (quebra consumidores).
- **`validateSkillPayload` reporta posição?** NÃO MEDIDO. Se o core só devolve `code`, campo e
  linha não existem para serem repassados — e o AC4 vira trabalho no core, não na rota.

## 3. `SKILL.md` avulso é caminho de entrada NOVO

`decodeBase64Zip` exige string base64 não-vazia e faz `Buffer.from(b64,'base64')`. O AC3 pede
aceitar um `SKILL.md` puro. Isso é uma segunda forma de entrada antes do `validateSkillPayload`
— não uma variação da existente.

## 4. Riscos que o DISCOVER expõe

| risco | por quê |
|---|---|
| **`:validate` gravar sem querer** | o AC2 exige contagem antes/depois; `ingestPayload` hoje não grava, mas quem escrever a rota pode reusar o handler de `POST` inteiro |
| **bomba de descompressão** | `Buffer.from` + unzip em rota sem escrita convida volume; o teto tem de ser do tamanho **descomprimido** |
| **divergência de contrato de erro** | ver § 2 — é decisão de design, não detalhe |

## 5. Próximo passo

`/to-plan` com `milestone_id: M30`. **Medir antes de planejar o AC4:** se `validateSkillPayload`
devolve posição. Sem isso, o AC4 é estimado no escuro.
