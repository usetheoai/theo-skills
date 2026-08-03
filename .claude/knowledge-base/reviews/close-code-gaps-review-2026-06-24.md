# Review: close-code-gaps

**Date:** 2026-06-24
**Reviewers (spawned agents):** 2 (security/correctness, cross-validation) — proportionate to a maintenance slice
**Findings:** 0 BLOCKER, 0 HIGH, 1 LOW (FIXED), rest INFO
**Verdict:** READY_TO_MERGE

## Scope

Slice de manutenção ad-hoc (sem milestone_id) fechando os 5 gaps de código levantados por um `knip`
manual + os follow-ups do review M9. Plan: `knowledge-base/plans/close-code-gaps-plan.md` (SHIPPABLE).
Diff: 3 commits (`829f81e` scrubbing recursion, `dcb71e8` Clock+deps, `0f480d6` logger hardening).

## Cross-validation: FULL COVERAGE — 5/5 gaps (100%)

| # | Gap | Resolvido | Evidência |
|---|---|---|---|
| #1 | dep morta `cuid2` (core) | ✅ | removida de core/package.json; core/src não usa (api usa+declara) |
| #2 | dep redundante `zod` (api) | ✅ | removida de api/package.json; api/src não importa direto; typecheck OK |
| #3 | export morto `realClock` | ✅ | deletado; grep retorna vazio |
| #4 | `Clock` duplicado | ✅ | consolidado em `time/clock.ts` (5→1); retrieve mantém `LatencyClock` interno (conceito distinto) |
| #5 | scrubbing raso | ✅ | recursão em objetos planos + 5 testes; arrays/Date/null preservados |

**Decisão de arquitetura validada (gap #4):** o agente confirmou que manter o clock monotônico do
retrieve (`now(): number`) **separado** do wall-clock (`now(): Date`) foi correto — forçar DRY entre
eles seria o anti-pattern de acoplamento acidental (`rules/architecture.md §6`, CLAUDE.md §12). O autor
foi além do plano: renomeou para `LatencyClock` com doc-comment distinguindo os conceitos.

## Findings + resolução

| ID | Sev | Finding | Resolução |
|---|---|---|---|
| F-sec-1 | LOW→FIXED | `scrubFields` estoura a pilha em referência circular (pré-existente — o código antigo já lançava `TypeError`; sem call-site alcançável, todos logam escalares) | **FIXED** (`0f480d6`) — `write()` envolto em try/catch: campo patológico → linha mínima segura `log_serialization_error`, nunca derruba o caller (Rule 8). + teste de regressão. |
| F-xval-1 | INFO | Plano listava webhook-sender entre os importadores do Clock; impl removeu o Clock morto dele (3 workers importam, não 4) | ACEITO — melhor que o spec (sender não tinha clock vivo). |
| F-xval-2 | INFO | knip sai 1 por 18 "unused exported types" | ACEITO/fora de escopo — são contratos de port/DI (NewDelivery/DeliveryRecord/InitDeps…), pré-existentes, NÃO tocados por esta slice; o DoD escopou *dead value-export* (= 0). Varrê-los seria scope-creep e risco de quebrar contratos de DI. |
| F-sec-2 | INFO | testes faltando: deeply-nested sensitive, sensitive-key-cujo-valor-é-objeto | parcial — o caso circular foi adicionado (o mais crítico); os demais são cobertos pela lógica (key-before-value ordering) — advisory. |

## Quality gates

- typecheck PASS · lint **0 warnings** · 
- **256 testes verdes**: 176 contract (core 56 + api 74 + cli 46) + 80 api integration
- **knip (manual):** 0 unused dependencies · 0 dead value-exports (era 2 deps + 1 export)
- code-quality: FAIL_SOFT — **única** causa `auditor_unavailable_knip` (o detector falha no `npx --yes knip` no subprocess offline; knip rodado manualmente está limpo — caveat de tooling EC-25-class, sem finding de código)

## Spawned agents (audit trail)

- security/correctness (issues-found→fixed: o LOW circular-ref), cross-validation (FULL COVERAGE 5/5).

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. Os 5 gaps fechados com evidência; o único finding (LOW
circular-ref no logger) foi corrigido de verdade (fire-and-forget, sem workaround) com teste de
regressão. Os 18 type-exports remanescentes são contratos de port pré-existentes, fora de escopo.
Proceder ao `/release` para v0.7.1 (patch — só `Changed`/`Removed`/`Security`, sem feature nova).
