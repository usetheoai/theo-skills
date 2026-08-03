---
slug: m30-authoring-api
milestone_id: M30
target_project: theo-skills
date: 2026-08-03
status: IMPLEMENTATION_COMPLETE
---

# M30 — implementação

| Tarefa | Commit | Mutação verificada |
|---|---|---|
| T1b — `field`/`line` no core | `9f3a49d` | linha vira constante → morre |
| T1a — atravessar os dois descartes | `2213bb4` | (typecheck + 116 testes do core) |
| T2/T3/T5 — a rota `:validate` | `92a132a` | rota removida → morre; efeito colateral → morre |
| T4 — `SKILL.md` avulso | `a2a501d` | `skillMd` ignorado → morre |

**Estado:** 30 arquivos de contrato, **159 testes verdes**, typecheck limpo.

## Cobertura contra a DoD

| AC | estado |
|---|---|
| AC1 — mesmo `code`, caminho compartilhado | ✅ o `:validate` chama o mesmo `ingestPayload`; a igualdade **entre rotas** é exercida na integração (ver § limite) |
| AC2 — zero efeito colateral por contagem | ✅ com zip **válido** — ver § o erro que a mutação pegou |
| AC3 — `SKILL.md` avulso, mesma extração | ✅ igualdade de campos entre os dois caminhos |
| AC4 — o erro diz **onde** | ✅ `{error, message, field, line}` |
| AC5 — escopo + limite | ✅ `requireScope('skills:read')` + `bodyLimit` |

## O erro que a mutação pegou, e que eu tinha commitado

A primeira versão do teste de zero-efeito **não discriminava**. Com o payload `'AAAA'`, que falha
cedo na validação, a rota nunca chega ao trecho onde enfileiraria — então acrescentar um
`queue.send` ao caminho de sucesso mantinha os três testes verdes.

Era literalmente **verde sobre nada**: o AC2 existe para impedir que o `:validate` grave, e o
teste não teria pego se ele gravasse. Corrigido com zip **válido**, o único caminho que exercita
o trecho. A mutação passou a morrer.

## Decisões registradas

- **Escopo de leitura**, não de escrita: validar não escreve, e exigir `skills:write` impediria
  quem só lê de conferir antes de pedir permissão. Mas **exige** escopo — a rota descomprime
  entrada arbitrária.
- **`SKILL.md` avulso vira zip de um arquivo** em vez de ganhar pipeline próprio. Segundo caminho
  seria a divergência que o AC1 combate.
- **`PayloadValidationError` segue sem `field`/`line`**: zip inseguro não tem campo culpado.
- **Campos acrescentados, `error` preservado** — renomear quebraria todo consumidor existente.

## Limite honesto

A igualdade de `code` **entre `:validate` e `POST`** não é exercitável sem banco: medido, o `POST`
consulta `isReserved`/`getView` **antes** de validar o zip, então com pool falso ele morre em
`internal_error`. Comparar ali seria comparar infraestrutura de teste, não vocabulário. Está
registrado no próprio teste; a comparação real pertence à suíte de integração.
