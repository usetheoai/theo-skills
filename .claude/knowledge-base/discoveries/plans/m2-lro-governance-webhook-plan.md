---
slug: m2-lro-governance-webhook
version: 0.1.0
owner: plataforma-theo
created_at: 2026-06-23
status: ready-for-execute
generated_by: discover-plan
---

# Discovery Plan — M2 LRO robusto + governança + webhook

## Context

ROADMAP M2 exige: operações idempotentes com estados explícitos + retry com backoff (transient)
e sem retry (business-rule); webhook de conclusão com assinatura + retry de entrega; e auditoria
testável (sucesso/falha/reentrega). O projeto irmão **theo-rag**
(`/home/paulo/Projetos/usetheo/theo-data/theo-rag`) já implementa um sistema de webhook completo
(SSRF guard, HMAC signing, sender, enqueuer+outbox, delivery worker com classificação de retry,
reconciler, schema, audit) sobre pg-boss — sem deps novas. Esta investigação extrai os padrões
exatos a reusar (Unbreakable Rule 9), evitando reinventar segurança (SSRF/HMAC).

## Objective

Blueprint que permita implementar M2 reusando os padrões validados do theo-rag, adaptando os
eventos de documento para eventos de skill (operação concluída), sem decisões em aberto.

## In-scope / Out-of-scope

### theo-rag (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`) — prior art primário
- **In scope:** `packages/api/src/server/webhooks/*` (url-safety, webhook-signing, webhook-sender,
  webhook-enqueuer, webhook-delivery-worker, webhook-reconciler), `packages/api/src/server/queue/queue.ts`
  (retry/DLQ config), `packages/core/src/infrastructure/db/schema.ts` (webhook tables),
  `packages/api/src/server/store/webhook-endpoints-store*.ts`.
- **Out of scope:** ingest pipeline, document status enums, collection patterns, RAG-specific payloads.

## ADRs (como investigar)

- **ADR-D1 — theo-rag é o template de webhook + retry.** Copiar verbatim os módulos de segurança
  (url-safety SSRF, webhook-signing HMAC); adaptar payloads/eventos de documento → skill. Time: 2h.
- **ADR-D2 — Reusar pg-boss nativo para retry/backoff/DLQ** (`retryLimit/retryBackoff/deadLetter`),
  não reinventar fila. Distinguir transient (retry) de business-rule (NonRetriableError → no retry).
- **ADR-D3 — Outbox via `webhook_deliveries` + reconciler** (FOR UPDATE SKIP LOCKED) para entrega
  at-least-once; idempotência via `singletonKey=delivery_id`.

## Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | Integration tests | Como o theo-rag testa o crash-window/reentrega do webhook (outbox recovery)? | Read `theo-rag/packages/api/tests/integration/webhooks-outbox.integration.test.ts` | Esqueleto AAA do teste de reentrega |
| Q2 | Dependencies | Quais deps o webhook usa? Alguma nova além do que já temos? | Read `theo-rag/packages/api/package.json` + os imports dos módulos webhook | Confirmação de zero deps novas (node:crypto/dns/net + pg-boss) |
| Q3 | Tools | Como o theo-rag configura o pg-boss retry/backoff/DLQ e o singletonKey? | Read `theo-rag/packages/api/src/server/queue/queue.ts` | Valores de retryLimit/retryDelay/retryBackoff/deadLetter/singletonSeconds |
| Q4 | Techniques | Como o SSRF guard bloqueia IPs privados e o HMAC assina/verifica? | Read `theo-rag/.../webhooks/{url-safety,webhook-signing}.ts` | Funções `assertPublicUrl` + `signWebhookBody`/`verifyWebhookSignature` |
| Q5 | Techniques | Como o delivery worker classifica retriabilidade (2xx/3xx/4xx/5xx) e o reconciler recupera órfãos? | Read `theo-rag/.../webhooks/{webhook-delivery-worker,webhook-reconciler}.ts` | Regra de classificação + claim FOR UPDATE SKIP LOCKED |
| Q6 | Techniques | Como modelar estados de operação (CREATING/UPDATING/DELETING/ACTIVE/FAILED) + idempotência + retry no worker de skill? | Read `theo-rag/.../worker.ts` (status transitions) + ROADMAP M2 DoD | Máquina de estados + idempotência por operação |

## Coverage Matrix

| Corner | Questions | Covered? |
|---|---|---|
| Integration tests | Q1 | ✅ |
| Dependencies | Q2 | ✅ |
| Tools | Q3 | ✅ |
| Techniques | Q4, Q5, Q6 | ✅ |

Total: 6 questions (1/1/1/3). Nenhum corner vazio.

## Halt-loop checkpoints (para /discover-execute)

Uma sub-questão só é `done` quando o path citado foi lido e a resposta tem a forma esperada
(função/valores/máquina de estados), com nomes literais.

## Acceptance Criteria

- [ ] 6 questions respondidas com citação a path real.
- [ ] Confirmação de zero deps novas.
- [ ] Config de retry/backoff/DLQ do pg-boss fixada (valores).
- [ ] SSRF guard + HMAC signing transcritos.
- [ ] Classificação de retriabilidade + reconciler documentados.
- [ ] Máquina de estados de operação + idempotência definidas.
- [ ] 4 coverage corners populados; sem citação fabricada.

## Global Definition of Done

Blueprint ≥ `SHIPPABLE_WITH_CAVEATS` em `/discover-confidence`. Respeita `rules/architecture.md`
(ports: `WebhookSender`, `WebhookEndpointsRepository`) e `rules/testing.md`.
