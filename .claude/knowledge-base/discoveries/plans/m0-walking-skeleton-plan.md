---
slug: m0-walking-skeleton
version: 0.1.0
owner: plataforma-theo
created_at: 2026-06-22
status: ready-for-execute
generated_by: discover-plan
---

# Discovery Plan — M0 Walking Skeleton

## Context

ROADMAP milestone **M0** exige um walking skeleton fim-a-fim na stack da casa
(monorepo pnpm `core`+`api`, Hono, pg-boss/LRO, Postgres+pgvector, Drizzle, E2E real).
O projeto irmão **theo-rag** (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`) já
implementa exatamente essa stack — Hono app factory, worker pg-boss com graceful
drain, Drizzle schema/migrations, testes de integração contra Postgres real. Antes de
escrever uma linha do skeleton, esta investigação extrai os **padrões concretos** a
reusar (Unbreakable Rule 9 — não reinventar), evitando retrabalho na fase `/implement`.

Evidência que dispara a investigação agora: M0 é a fundação; um erro de wiring
(graceful shutdown, ordem server→boss→pool, reset de DB nos testes) propaga para todos
os milestones seguintes.

## Objective

Produzir um blueprint que permita implementar o M0 sem decisões em aberto, espelhando o
padrão validado do theo-rag.

**Success criteria (do blueprint resultante):**
- Estrutura de arquivos do skeleton (`core` + `api`) derivada de paths reais do theo-rag.
- Versões exatas de deps a herdar (hono, pg-boss, drizzle-orm/kit, pg, zod).
- Padrão de LRO com pg-boss (enfileirar job → persistir operation → worker atualiza done).
- Shape do teste E2E criar→aguardar→obter, espelhando os testes de integração do theo-rag.
- Graceful shutdown ordenado documentado.

## In-scope / Out-of-scope

### theo-rag (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`) — prior art primário
- **In scope:** `packages/api/src/server.ts`, `packages/api/src/server/app.ts`,
  `packages/core/src/infrastructure/db/schema.ts`, `packages/core/drizzle.config.ts`,
  `docker-compose.yaml`, `packages/api/tests/integration/*`, `packages/*/package.json`.
- **Out of scope:** domínio de RAG (`packages/core/src/domain/{loaders,chunkers,embedders,rerankers,pipeline}`),
  `packages/core/src/contract/*` de RAG, `dogfood/`, `.claude/`.

### knowledge-base/references/openskills — parsing SKILL.md (TS)
- **In scope:** `src/` (parser de frontmatter).
- **Out of scope:** docs, fixtures de exemplo, testes de instalação.

### knowledge-base/references/mcp-context-forge — padrão de operação/registry
- **In scope:** modelagem de operação assíncrona e estado.
- **Out of scope:** federação multi-protocolo, UI, deploy K8s.

## ADRs (como investigar)

- **ADR-D1 — theo-rag é o prior art primário, citado por path absoluto.** É o template
  autoritativo da casa com a stack idêntica; mais relevante que qualquer peer externo.
  Não está em `knowledge-base/references/` (é projeto irmão acessível em disco). Time-budget: 3h.
- **ADR-D2 — Profundidade limitada ao esqueleto.** Investiga app factory, LRO pg-boss,
  Drizzle, E2E e shutdown; ignora a lógica de domínio de RAG (YAGNI para M0).
- **ADR-D3 — Citações de peers externos restritas a `openskills` e `mcp-context-forge`.**
  Os demais peers (semantic-router, composio, etc.) pertencem a milestones posteriores
  (M4/M6), fora do escopo de M0.

## Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | Integration tests | Como o theo-rag estrutura testes de integração contra Postgres real + worker pg-boss (vitest config, global-setup, reset de DB, fileParallelism)? | Read `theo-rag/vitest.integration.config.ts`, `theo-rag/packages/api/tests/integration/worker-drain.integration.test.ts`; grep `globalSetup`/`beforeAll` | Lista de: config keys (timeout, fileParallelism), arquivo de global-setup, técnica de reset de DB |
| Q2 | Integration tests | Que shape de teste "criar→processar→obter" (contract/integration) existe que eu possa espelhar para create-skill→operation→get-skill? | Read `theo-rag/packages/api/tests/contract/documents.contract.test.ts`, `tests/integration/documents-pg.integration.test.ts` | Esqueleto AAA do teste E2E: arrange (post), act (poll operation), assert (get) |
| Q3 | Dependencies | Quais versões exatas de hono, @hono/node-server, pg-boss, drizzle-orm, drizzle-kit, pg, zod o theo-rag fixa? | Read `theo-rag/packages/api/package.json`, `theo-rag/packages/core/package.json` | Tabela package→versão a herdar |
| Q4 | Tools | Como o theo-rag configura docker-compose (pgvector), drizzle.config.ts e scripts pnpm (db:push, dev, test:integration)? | Read `theo-rag/docker-compose.yaml`, `theo-rag/packages/core/drizzle.config.ts`, `theo-rag/package.json` + `packages/*/package.json` scripts | Serviço(s) compose, env var de URI, comandos pnpm |
| Q5 | Techniques | Como o theo-rag faz o app factory Hono (createApp) + montagem `/v1/*` + graceful drain ordenado (server.close → boss.stop → pool.end)? | Read `theo-rag/packages/api/src/server.ts`, `theo-rag/packages/api/src/server/app.ts`; grep `SHUTDOWN`/`drain`/`boss.stop` | Sequência de shutdown + assinatura de createApp |
| Q6 | Techniques | Como modelar a LRO com pg-boss (enfileirar job, persistir operation, worker atualiza done)? Comparar com a modelagem de operação do mcp-context-forge. | Grep `boss.work`/`boss.send`/`createQueue` em `theo-rag/packages/api/src`; ler modelagem de operação em `knowledge-base/references/mcp-context-forge` | Fluxo: send(job) → row operation `state` → worker handler → update done |

## Coverage Matrix

| Corner | Questions | Covered? |
|---|---|---|
| Integration tests | Q1, Q2 | ✅ 100% |
| Dependencies | Q3 | ✅ 100% |
| Tools | Q4 | ✅ 100% |
| Techniques | Q5, Q6 | ✅ 100% |

Total: 6 questions (2/1/1/2 por corner). Nenhum corner vazio. Nenhuma deferral.

## Halt-loop checkpoints (para /discover-execute)

Uma sub-questão só é `done` quando:
- O path citado foi efetivamente lido (não inferido) e o trecho relevante transcrito no blueprint.
- A resposta tem a forma esperada (tabela/sequência/esqueleto), não prosa vaga.
- Versões e nomes de símbolos são literais do código lido (sem fabricação).

## Acceptance Criteria

- [ ] Todas as 6 questions respondidas com citação a path real lido.
- [ ] Tabela de versões de deps preenchida com valores literais do theo-rag.
- [ ] Sequência de graceful shutdown documentada com a ordem exata.
- [ ] Esqueleto AAA do E2E pronto para virar teste RED em `/implement`.
- [ ] 4 coverage corners populados; nenhuma citação fabricada.

## Global Definition of Done

Blueprint atinge verdict ≥ `SHIPPABLE_WITH_CAVEATS` em `/discover-confidence` conforme
`rules/discover-blueprint-golden-rule.md` (4 corners não-vazios, citações resolvíveis).
Respeita `rules/architecture.md` (fronteiras domínio↔infra) e `rules/testing.md`
(pirâmide: E2E poucos e representativos).
