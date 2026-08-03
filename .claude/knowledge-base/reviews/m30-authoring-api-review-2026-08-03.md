---
slug: m30-authoring-api
milestone_id: M30
date: 2026-08-03
verdict: READY_TO_MERGE
---

# Review — M30

**Veredito: `READY_TO_MERGE`.** Nenhum BLOCKER; duas observações MEDIUM, ambas já registradas no
próprio código.

## Gates duros (`cycle-review § Hard gates`)

| gate | resultado |
|---|---|
| testes verdes na branch | ✅ core 116, api 159 (30 arquivos de contrato) |
| segredos no diff | ✅ nenhum |
| commit direto em `main` | ✅ não — tudo em `workspace` |
| trailer `Co-Authored-By` | ✅ zero |
| CHANGELOG atualizado | ✅ quatro entradas, uma por tarefa |
| `/code-quality` | ✅ **PASS**, `hard_caps: []`, `soft_caps: []` |

## Arquitetura

O `:validate` chama o **mesmo** `ingestPayload` das rotas de escrita, e o `SKILL.md` avulso vira
zip de um arquivo antes de entrar nele — em vez de ganhar pipeline próprio. É a decisão que
sustenta o AC1: dois caminhos que hoje concordam divergem no primeiro campo novo.

A propagação `core → BoundaryError → HTTP` **acrescenta** campos (`message`, `field`, `line`) e
preserva `error`. Renomear `error`→`code` seria mais limpo e quebraria todo consumidor de
`POST /v1/skills`.

## Testes — o achado que vale registrar

O teste de zero-efeito colateral **não discriminava**, e foi corrigido durante o implement: com
payload que falha cedo, a rota nunca alcançava o trecho perigoso, e um `queue.send` acrescentado
ao caminho de sucesso mantinha tudo verde. Corrigido com zip válido; a mutação passou a morrer.
Quatro mutações verificadas no total, uma por tarefa.

## Findings MEDIUM (não bloqueiam; ambos documentados no código)

1. **A igualdade de `code` entre `:validate` e `POST` não é exercitada sem banco.** Medido: o
   `POST` consulta `isReserved`/`getView` antes de validar o zip, então com pool falso morre em
   `internal_error`. Comparar ali compararia infraestrutura de teste. A comparação real pertence à
   suíte de integração — que exige `THEOSKILL_PG_URI` e não rodou nesta sessão.
2. **`field`/`line` cobrem frontmatter, não zip-safety.** `PayloadValidationError` segue sem eles,
   deliberadamente: um zip inseguro não tem campo culpado no `SKILL.md`. Consequência honesta: o
   AC4 entrega posição para a classe de erro mais comum, não para todas.

## Wiring

Caller real (a rota registrada em `registerSkillsRoutes`), teste de contrato exercitando-a ponta a
ponta, e `bodyLimit` + `requireScope` no caminho. Sem símbolo órfão — `/code-quality` confirma com
`hard_caps: []`.
