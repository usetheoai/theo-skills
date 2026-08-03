---
slug: m0-walking-skeleton
version: 1.0.0
owner: plataforma-theo
created_at: 2026-06-22
generated_by: discover-execute
source_plan: knowledge-base/discoveries/plans/m0-walking-skeleton-plan.md
---

# Blueprint: M0 Walking Skeleton

Padrões concretos extraídos do prior art para implementar o M0 sem retrabalho.
Fonte primária: **theo-rag** (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`),
mesma stack da casa. Todas as citações foram lidas, não inferidas.

## Context

ROADMAP milestone **M0** exige um walking skeleton fim-a-fim na stack da casa. O projeto
irmão theo-rag já implementa Hono + pg-boss (LRO) + Postgres+pgvector + Drizzle em monorepo
`core`+`api`. Esta investigação extraiu os padrões concretos (estrutura, versões, LRO,
graceful shutdown, E2E) para que `/implement` não reinvente nada (Unbreakable Rule 9). Os
peers `openskills` e `mcp-context-forge` (em `knowledge-base/references/`) confirmam o
formato de skill e a modelagem de operação.

## Objective

Fatia fim-a-fim mais fina que prova a arquitetura: `POST /v1/skills` enfileira uma operação
(pg-boss) → worker persiste a skill e marca a operação `done` → `GET /v1/operations/{id}`
reporta `done` → `GET /v1/skills/{id}` retorna a skill. `GET /v1/health` para liveness.
Monorepo pnpm `core`+`api`, TS strict, Drizzle + migrations, E2E contra Postgres real.

## Coverage Corner 1 — Integration Tests

**Q1 — testar contra Postgres real + worker pg-boss.**
Padrão do theo-rag (`packages/api/tests/integration/_helpers/env.ts:8`):

```ts
const hasDb = Boolean(process.env?.['THEORAG_PG_URI']);
export const describeIntegration = describe.skipIf(!hasDb);
```

→ Para nós: `describe.skipIf(!process.env.THEOSKILL_PG_URI)`. CI sem Postgres **pula** sem
quebrar; com Postgres, roda. Config (`packages/api/vitest.integration.config.ts`):
`testTimeout: 30_000`, `hookTimeout: 30_000`, `fileParallelism: false`, `globals: false`,
`passWithNoTests: true`. Reset entre testes (`_helpers/db.ts:52`):

```ts
export async function truncateAll() {
  const pool = await getPool();
  await pool.query('TRUNCATE TABLE operations, skills RESTART IDENTITY CASCADE');
}
export function setupCleanDb(hooks) {
  hooks.beforeEach(async () => { await truncateAll(); });
  hooks.afterAll(async () => { await closePool(); });
}
```

**Q2 — shape AAA do E2E criar→processar→obter** (espelha `documents-pg.integration.test.ts:143`):

```ts
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { getPool, setupCleanDb } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

describeIntegration('M0 skill async flow', () => {
  setupCleanDb({ beforeEach, afterAll });
  it('POST /v1/skills → poll operation done → GET skill', async () => {
    const pool = await getPool();
    const boss = await startBoss();
    const app = createApp({ pool, queue: boss });
    await registerWorker({ pool, queue: boss });

    const create = await app.request('/v1/skills', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: 'demo-skill', name: 'Demo', description: 'x' }) });
    expect(create.status).toBe(202);
    const { operation_id } = await create.json();

    let op; for (let i = 0; i < 50; i++) {
      const r = await app.request(`/v1/operations/${operation_id}`);
      op = await r.json(); if (op.state === 'done') break;
      if (op.state === 'failed') throw new Error('op failed');
      await new Promise(res => setTimeout(res, 100));
    }
    expect(op.state).toBe('done');

    const get = await app.request('/v1/skills/demo-skill');
    expect(get.status).toBe(200);
    expect((await get.json()).name).toBe('Demo');
  });
});
```

## Coverage Corner 2 — Dependencies

**Q3 — versões exatas a herdar** (lidas de `theo-rag/packages/{api,core}/package.json`):

| Package | Versão | Onde |
|---|---|---|
| hono | ^4.12.25 | api |
| @hono/node-server | ^1.13.0 | api |
| @hono/zod-openapi | ^0.18.0 | api |
| pg-boss | ^10.4.2 | api |
| pg | ^8.13.0 | api + core |
| drizzle-orm | ^0.45.0 | api + core |
| drizzle-kit | ^0.31.0 | core (dev) |
| zod | ^3.25.0 | api + core |
| @opentelemetry/api | ^1.9.1 | api |
| @paralleldrive/cuid2 | ^2.3.1 | api + core |
| vitest | ^4.0.0 | dev |
| typescript | ^5.4.0 | dev |
| tsx | ^4.19.0 | dev |
| @types/node | ^20.0.0 | dev |
| @types/pg | ^8.11.0 | dev |
| eslint | ^9.0.0 | dev |
| typescript-eslint | ^8.0.0 | dev |
| eslint-plugin-import | ^2.30.0 | dev |

`tsconfig.base.json` (de `theo-rag/packages/api/tsconfig.json`): `target es2022`,
`module nodenext`, `moduleResolution nodenext`, `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
`verbatimModuleSyntax`, `isolatedModules`, ESM (`"type":"module"`).

## Coverage Corner 3 — Tools

**Q4 — docker-compose + drizzle.config + scripts.**
`docker-compose.yaml` (de `theo-rag/docker-compose.yaml:22`): imagem `ankane/pgvector:v0.5.1`,
serviço `pgvector`, porta `127.0.0.1:5432:5432`. Para nós: user/pass/db = `theoskill`, env
de conexão **`THEOSKILL_PG_URI`** (default `postgresql://theoskill:theoskill@localhost:5432/theoskill`).

`drizzle.config.ts` (de `theo-rag/packages/core/drizzle.config.ts:12`):

```ts
export default defineConfig({
  schema: './src/infrastructure/db/schema.ts',
  out: './src/infrastructure/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env['THEOSKILL_PG_URI'] ?? 'postgresql://theoskill:theoskill@localhost:5432/theoskill' },
  strict: true,
});
```

Scripts (raiz): `compose:up: docker compose up -d pgvector`, `test`, `test:integration`,
`typecheck`, `lint`, `build` via `pnpm -r`. Por package: `typecheck: tsc --noEmit`,
`test: vitest run --config vitest.contract.config.ts`,
`test:integration: vitest run --config vitest.integration.config.ts`, `start: tsx src/server.ts`,
`db:push`/`db:generate` via drizzle-kit no `core`.

## Coverage Corner 4 — Techniques

**Q5 — app factory + graceful shutdown.**
App factory (`theo-rag/.../server/app.ts:273`): `createApp(opts): OpenAPIHono`, recebe
`pool`/`queue`, registra `app.onError` mapeando erros de PG para HTTP, middlewares e rotas
`/v1/*` via `registerXRoutes(app, deps)`.

Graceful shutdown (`theo-rag/.../server.ts:165` + `server/queue/graceful-drain.ts:31`), ordem
**não-negociável**, deadline 30s, idempotente em SIGTERM/SIGINT:

```
1. server.close()   // para de aceitar conexões
2. queue.stop()     // drena jobs in-flight do pg-boss
3. pool.end()       // libera conexões por último
```

`setupGracefulDrain({ drainables, timeoutMs: 30_000, logger })`: executa drainables em ordem
sequencial; `setTimeout` mata o processo (`exit(1)`) no deadline; `once('SIGTERM'/'SIGINT')`;
flag `draining` evita reentrância.

**Q6 — LRO com pg-boss** (de `theo-rag/.../server/queue/queue.ts` + `worker.ts:312`):

```
boss = new PgBoss({ connectionString: THEOSKILL_PG_URI, application_name: '@usetheo/skillregistry-api' })
await boss.start()                         // bootstrap schema pgboss.* — ANTES de serve()
await boss.createQueue('create_skill')     // pg-boss v10 exige createQueue
const jobId = await boss.send('create_skill', { operation_id, skill_id, payload }, { retryLimit: 0 })
await boss.work('create_skill', { pollingIntervalSeconds: 1, includeMetadata: true }, async (jobs) => {
  for (const job of jobs) { await handleCreateSkill(job.data) }  // valida → INSERT skill → UPDATE operation done
})
```

`boss.work` recebe **array** de jobs (v10). O handler dirige a máquina de estados da nossa
tabela `operations`: `CREATING` → `done` (sucesso) / `failed` + `error` (erro, lançando para
o pg-boss; a tabela já gravou `failed` — fail-loud, Unbreakable Rule 8).

## Cross-cutting Comparison

| Dimensão | theo-rag (template) | mcp-context-forge | Decisão para M0 |
|---|---|---|---|
| Estado da operação | no recurso (`documents.status`) | tabela de operação dedicada | **Tabela `operations` própria** (DoD exige `GET /v1/operations/{id}`) |
| Worker | processo separado (`worker.ts`) | embutido no server | **Mesmo processo** no M0 (KISS); separar é M2/M8 |
| Fila | pg-boss | fila própria/externa | **pg-boss** (stack da casa, sem Redis) |
| Formato de skill | n/a (documentos) | registro de assets | **Frontmatter Theokit** (campos mínimos no M0) |
| Graceful drain | server→queue→pool, 30s | — | **Idêntico ao theo-rag** (padrão validado) |

`openskills` confirma o parser de frontmatter `SKILL.md` em TS (relevante a M1, não a M0).
`mcp-context-forge` confirma a operação como entidade de primeira classe (justifica ADR D1).

## ADRs

### D1 — Tabela `operations` própria (não o estado nativo do pg-boss)

O DoD do M0 exige `GET /v1/operations/{id}`. O theo-rag mapeia estado no recurso de domínio;
o nosso contrato expõe a operação como entidade de primeira classe (como o Google Skill
Registry e o ROADMAP). Modelamos `operations(operation_id, skill_id, type, state, error,
create_time, update_time)`. pg-boss carrega só o job; a verdade do estado vive na nossa
tabela. **Rejeitado:** expor `pgboss.job` — acopla o contrato público ao schema da fila.

### D2 — `createApp({ pool, queue })` injeta dependências (DIP)

App factory Hono recebe `Pool` e `PgBoss` por parâmetro, testável via `app.request()` sem
socket (espelha `theo-rag/.../server/app.ts:273`). **Rejeitado:** singletons globais —
quebram testabilidade e violam DIP (`rules/architecture.md`).

### D3 — Worker no mesmo processo do server no M0

O theo-rag separa `server.ts`/`worker.ts`. Para o walking skeleton (KISS/YAGNI), o worker
registra `boss.work` após `boss.start` no mesmo processo, com o mesmo graceful drain.
**Rejeitado:** processo de worker separado — overhead de orquestração sem ganho no M0
(evolução de M2/M8).

### D4 — Formato de skill alinhado ao Theokit já no M0

Payload mínimo `{ skill_id, name, description }` com validação de `skillId`
(charset/imutável). O parser completo de `SKILL.md` zipado é M1. **Rejeitado:** adiar o
alinhamento Theokit — retrabalho garantido em M1/M7.

## Recommendations for the project

1. Herdar as versões exatas da tabela do Corner 2 — não resolver ranges novos (evita drift
   com os demais serviços Theo).
2. Copiar o padrão `setupGracefulDrain` + ordem server→queue→pool **verbatim** — é o ponto
   de maior risco de wiring do M0.
3. Implementar a tabela `operations` com `state ∈ {CREATING, done, failed}` e `error` nullable
   desde o início (D1); estados ricos (`UPDATING/DELETING`) entram em M1/M2.
4. Escrever o teste E2E do Corner 1 como o primeiro RED do `/implement` (TDD).
5. `describe.skipIf(!THEOSKILL_PG_URI)` para que o contrato (unit) rode sem DB e o E2E só
   com `docker compose up -d pgvector`.

## Acceptance Criteria — status

- [x] 6 questions respondidas com citação a path real lido.
- [x] Tabela de versões literais preenchida.
- [x] Sequência de graceful shutdown documentada (server→queue→pool, 30s).
- [x] Esqueleto AAA do E2E pronto para virar teste RED.
- [x] 4 coverage corners populados; sem citação fabricada.

## Related

- Plano: `knowledge-base/discoveries/plans/m0-walking-skeleton-plan.md`
- Prior art: theo-rag (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`)
- Peers: `knowledge-base/references/openskills`, `knowledge-base/references/mcp-context-forge`
- ROADMAP M0; `rules/architecture.md`, `rules/testing.md`
