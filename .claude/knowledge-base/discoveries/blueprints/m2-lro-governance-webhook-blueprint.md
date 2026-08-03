---
slug: m2-lro-governance-webhook
version: 1.0.0
owner: plataforma-theo
created_at: 2026-06-23
generated_by: discover-execute
source_plan: knowledge-base/discoveries/plans/m2-lro-governance-webhook-plan.md
---

# Blueprint: M2 LRO robusto + governança + webhook

Padrões concretos do theo-rag a reusar (Unbreakable Rule 9), adaptados de eventos de documento
para eventos de skill. Fonte: `theo-rag/packages/api/src/server/webhooks/*` + `queue/queue.ts`.
Zero dependências novas (node:crypto/dns/net + pg-boss já presentes). Citações lidas.

## Context

ROADMAP M2 endurece a LRO (estados explícitos + idempotência + retry transient/no-retry
business) e adiciona webhook de conclusão (assinatura HMAC + retry de entrega + reconciliação)
e auditoria. O theo-rag já provou esse sistema; copiamos os módulos de segurança verbatim e
adaptamos os eventos.

## Objective

Fixar (1) a máquina de estados de operação + idempotência + classificação de retry; (2) os
módulos de webhook a copiar (SSRF, HMAC, sender, enqueuer, worker, reconciler) e seu schema;
(3) a auditoria — de forma que `/implement` não tome decisões de design nem reinvente segurança.

## Coverage Corner 1 — Integration Tests

**Q1 — teste de crash-window/reentrega (outbox recovery).**
Padrão do theo-rag (`packages/api/tests/integration/webhooks-outbox.integration.test.ts`):
simula o crash (recordDelivery ok, queue.send nunca rodou → linha órfã com
`delivered_at/failed_at/enqueued_at` NULL), roda `runReconcileOnce({orphanAgeMs:0})`, asserta
`reEnqueued ≥ 1` e `enqueued_at` carimbado; segunda passada `claimed == 0` (idempotente).

Para nós, os testes de integração de M2 cobrem: (a) operação create/update/delete →
webhook entregue (2xx → `delivered_at`); (b) endpoint 5xx → retry (attempt_count cresce) →
após esgotar, DLQ; (c) endpoint 4xx → `failed_at` sem retry (NonRetriable); (d) crash-window →
reconciler reentrega; (e) operação idempotente: reprocessar um job de op já `ACTIVE`/`FAILED` é no-op.

## Coverage Corner 2 — Dependencies

**Q2 — deps.** Zero novas. Os módulos webhook usam só `node:crypto` (HMAC/timingSafeEqual),
`node:dns/promises` + `node:net` (SSRF), `@paralleldrive/cuid2` (ids), `pg-boss` (fila/retry/DLQ),
`drizzle-orm` — todos já no projeto (M0/M1). Confirmado nos imports de `theo-rag/.../webhooks/*`.

## Coverage Corner 3 — Tools

**Q3 — config pg-boss retry/backoff/DLQ + singletonKey** (de `theo-rag/.../queue/queue.ts`):

```ts
export const WEBHOOK_DELIVERY_DLQ_QUEUE_NAME = 'webhook_delivery_dlq';
export const WEBHOOK_DELIVERY_SEND_OPTIONS = Object.freeze({
  retryLimit: 5, retryDelay: 2, retryBackoff: true, expireInSeconds: 60,
  deadLetter: WEBHOOK_DELIVERY_DLQ_QUEUE_NAME,
}); // delays 2,4,8,16,32s
export const WEBHOOK_DELIVERY_SINGLETON_SECONDS = 120; // dedup window for re-enqueue
```

Para os jobs de skill (create/update/delete) — M2 muda de `retryLimit:0` para retry de transient:
`{ retryLimit: 3, retryDelay: 2, retryBackoff: true }`. Business-rule = `NonRetriableError`
(capturado → no-op, sem retry; operação `FAILED`).

## Coverage Corner 4 — Techniques

**Q4 — SSRF guard + HMAC** (copiar verbatim de `theo-rag/.../webhooks/{url-safety,webhook-signing}.ts`):
- `assertPublicUrl(rawUrl, resolver?)`: bloqueia esquema ≠ http/https, IPs privados (lookup table
  IPv4 0/10/100.64/127/169.254/172.16-31/192.168/198.18; IPv6 ::1, ULA fc/fd, link-local fe8x,
  multicast ff, mapped/NAT64/6to4), resolve DNS e revalida. `UrlSafetyError(reason)`.
- `signWebhookBody(secret, body, tsSeconds)` = `t=<ts>&s=<hmac-sha256(body||ts)>` (Inngest scheme);
  `verifyWebhookSignature` com guard de comprimento/hex ANTES de `timingSafeEqual` + replay ±300s.

**Q5 — classificação de retriabilidade + reconciler** (de `webhook-delivery-worker.ts` + `webhook-reconciler.ts`):
- 2xx → `markDelivered` (job completo). 3xx+4xx → `markFailed` + `NonRetriableError` (capturado no
  topo → job NÃO retry, vai pro DLQ). 5xx/network/timeout → `markFailed` + throw plain Error
  (pg-boss aplica retryBackoff). SSRF guard ANTES do fetch; endpoint cascade-deleted → NonRetriable.
- Reconciler: `claimOrphanedDeliveries({limit, olderThan})` com `FOR UPDATE SKIP LOCKED`
  (delivered/failed/enqueued NULL e create_time < olderThan), re-enfileira com
  `singletonKey=delivery_id`, carimba `enqueued_at`. `startReconciler(deps, intervalMs)` com guard
  de reentrância + `unref()`; parado ANTES de `queue.stop` no graceful drain.

**Q6 — estados de operação + idempotência + retry no worker de skill.**
- `operations.state ∈ {CREATING, UPDATING, DELETING, ACTIVE, FAILED}`. Em progresso pelo tipo do
  job (create→CREATING, update→UPDATING, delete→DELETING); terminal sucesso=`ACTIVE`, falha=`FAILED`.
  (Migra M1: `done`→`ACTIVE`, `failed`→`FAILED`.)
- **Idempotência:** (a) a request aceita header `Idempotency-Key`; persistido em
  `operations.idempotency_key` (único parcial) — reenvio com a mesma chave devolve a operação
  existente. (b) o worker é idempotente: ao iniciar, se a operação já está `ACTIVE`/`FAILED`,
  retorna no-op (reprocessamento por retry não duplica efeito).
- **Retry:** create/update/delete jobs com `retryLimit:3 + retryBackoff`. O handler lança
  `NonRetriableOperationError` para violação de regra (validação/unique) → captura → operação
  `FAILED`, sem retry; erro transitório (DB blip) → throw plain → pg-boss retry.

## Cross-cutting Comparison

| Dimensão | theo-rag | M2 (skill-registry) | Decisão |
|---|---|---|---|
| Eventos | document.status_changed | skill.created/updated/deleted | adaptar payload |
| Scope de endpoint | workspace_id | (sem workspace) global por projeto | omitir workspace; M6 adiciona RBAC |
| Retry de job de domínio | ingest retryLimit:0 | create/update/delete retryLimit:3+backoff | retry de transient (M2 DoD) |
| Estados de operação | document.status | CREATING/UPDATING/DELETING/ACTIVE/FAILED | máquina explícita (M2 DoD) |
| Delete | n/a | LRO (DELETING) | delete vira assíncrono (evolui M1 ADR-5) |
| SSRF/HMAC | url-safety/webhook-signing | idem (copiar) | reusar verbatim (segurança) |

## ADRs

### D1 — Copiar os módulos de segurança do theo-rag verbatim (SSRF + HMAC)

`url-safety.ts` (assertPublicUrl + fetchWithPinnedDns) e `webhook-signing.ts` (HMAC-SHA256 +
verify) são código de segurança auditado; copiar com adaptação mínima.
**Rationale:** Unbreakable Rule 9 — não reinventar SSRF/cripto. **Rejeitado:** regex/validação
caseira de URL ou assinatura própria — risco de SSRF/timing-attack.

### D2 — pg-boss nativo para retry/backoff/DLQ; NonRetriableError para business-rule

Jobs de webhook: `retryLimit:5 + retryBackoff + deadLetter`. Jobs de skill: `retryLimit:3 +
backoff`; `NonRetriableOperationError`/`NonRetriableDeliveryError` capturado no topo → sem retry.
**Rationale:** M2 DoD (retry transient, no-retry business); pg-boss já provê. **Rejeitado:**
fila/retry próprios.

### D3 — Outbox via `webhook_deliveries` + reconciler (at-least-once)

`recordDelivery` (PG) + `queue.send` não são atômicos; a linha `webhook_deliveries` É o outbox
durável; o reconciler recupera órfãos (`FOR UPDATE SKIP LOCKED`) e reenfileira idempotentemente
(`singletonKey=delivery_id`). Consumidores deduplicam por `event_id`.
**Rationale:** entrega at-least-once (M2 risk #1). **Rejeitado:** entrega in-line síncrona
(perde o evento se o endpoint estiver lento/fora).

### D4 — Delete vira LRO (DELETING) no M2

Para ter o estado `DELETING`, disparar webhook on completion e auditar via operação, o delete
passa a ser assíncrono (enfileira `delete_skill`). Evolui a decisão de delete-síncrono do M1.
**Rationale:** M2 DoD lista `DELETING`. **Rejeitado:** manter delete síncrono — não teria estado
`DELETING` nem operação auditável.

### D5 — Idempotência por `Idempotency-Key` + worker idempotente

Request opcionalmente traz `Idempotency-Key` → `operations.idempotency_key` (único). O worker
no-op se a operação já é terminal (reprocessamento por retry seguro).
**Rationale:** M2 DoD ("operações idempotentes"). **Rejeitado:** sem idempotência — retry
duplicaria efeitos.

## Recommendations for the project

1. Copiar os 7 módulos de webhook para `packages/api/src/server/webhooks/` adaptando só payloads.
2. Ports no `core`: `WebhookSender`, `WebhookEndpointsRepository` (DIP); adapter HTTP + PG na api.
3. Schema: `webhook_endpoints` (id, url, secret, active, event_types, timestamps) +
   `webhook_deliveries` (id, endpoint_id, event_type, payload jsonb, attempt_count, delivered_at,
   failed_at, enqueued_at, create_time + índice parcial de órfãos).
4. Disparar o webhook quando a operação atinge terminal (`ACTIVE`/`FAILED`) — via enqueuer no worker.
5. Auditoria = `operations` (mutações create/update/delete com estado+timestamps+error) +
   `webhook_deliveries` (tentativas). Testes de integração: sucesso, falha (4xx no-retry / 5xx
   retry→DLQ), reentrega (reconciler).
6. `node:crypto`/`dns`/`net` — não adicionar dep. `secret` do endpoint gerado server-side
   (randomBytes), retornado 1x na criação.

## Acceptance Criteria — status

- [x] 6 questions respondidas com citação a path real.
- [x] Zero deps novas confirmado.
- [x] Config de retry/backoff/DLQ fixada.
- [x] SSRF guard + HMAC documentados.
- [x] Classificação de retriabilidade + reconciler documentados.
- [x] Máquina de estados de operação + idempotência definidas.
- [x] 4 coverage corners populados; sem citação fabricada.

## Related

- Plano: `knowledge-base/discoveries/plans/m2-lro-governance-webhook-plan.md`
- Prior art: theo-rag (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`)
- M1: `knowledge-base/discoveries/blueprints/m1-skill-model-validation-blueprint.md`; PRD §4; ROADMAP M2.
