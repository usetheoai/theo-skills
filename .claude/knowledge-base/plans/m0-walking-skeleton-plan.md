---
slug: m0-walking-skeleton
milestone_id: M0
created_at: 2026-06-22
goal: Walking skeleton fim-a-fim (Hono + pg-boss LRO + Postgres/Drizzle) provando a arquitetura do Theo Skill Registry.
generated_by: to-plan
source_blueprint: knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md
---

# Plan: M0 — Walking Skeleton

## Goal

Entregar a fatia fim-a-fim mais fina que prova a arquitetura do Theo Skill Registry na
stack da casa: um monorepo pnpm (`core` + `api`) em TS strict onde `GET /v1/health`
responde liveness, `POST /v1/skills` enfileira uma operação via pg-boss, o worker persiste
a skill e marca a operação concluída, `GET /v1/operations/{id}` reporta `done` e
`GET /v1/skills/{id}` retorna a skill — validado por um teste E2E contra Postgres real.

## Context

Primeiro milestone do ROADMAP. Nenhum código de produção existe ainda (só docs/roadmap).
O blueprint `m0-walking-skeleton` extraiu os padrões do theo-rag (mesma stack). Este plano
decompõe a implementação em fases TDD, reusando versões e padrões validados (Unbreakable
Rule 9 — não reinventar).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC atual | Estado | Papel após M0 |
|---|---|---|---|
| `package.json` (raiz) | 0 (inexistente) | a criar | workspace pnpm + scripts agregados |
| `pnpm-workspace.yaml` | 0 | a criar | declara `packages/*` |
| `tsconfig.base.json` | 0 | a criar | compilerOptions strict compartilhados |
| `eslint.config.ts` | 0 | a criar | flat config typescript-eslint |
| `docker-compose.yaml` | 0 | a criar | `ankane/pgvector:v0.5.1` |
| `packages/core/**` | 0 | a criar | `@usetheo/skillregistry`: schema, contracts, domain |
| `packages/api/**` | 0 | a criar | `@usetheo/skillregistry-api`: Hono, queue, worker, handlers |
| `CHANGELOG.md` | 13 | existe | nova entry `[Unreleased] § Added` |

### Current callers / dependents

Nenhum. Greenfield — não há consumidores internos ainda. O consumidor futuro (Theokit
`RemoteSkillsManager`) só entra em M7. Nenhum código existente importa estes módulos.

### Domain glossary

| Termo | Definição |
|---|---|
| Skill | Pacote versionado de capacidade de agente; no M0, registro mínimo `{ skill_id, name, description }`. |
| skillId | Identificador imutável: 1–63 chars, `[a-z0-9-]`, começa com letra, termina com letra/dígito, não começa com `gcp-`. |
| Operation (LRO) | Operação assíncrona de primeira classe com `state ∈ {CREATING, done, failed}`. |
| Worker | Consumidor pg-boss que processa o job `create_skill` no mesmo processo do server (M0). |

### Architecture boundaries affected

`core` (domínio + infra de DB) não depende de `api`. `api` depende de `core`. Handlers
roteiam; lógica de persistência vive nos stores (DIP — `rules/architecture.md`). Sem object
storage, sem Redis (constraint do ROADMAP).

## Prior Art & Related Work

- Blueprint `m0-walking-skeleton` (citações reais ao theo-rag).
- theo-rag (`/home/paulo/Projetos/usetheo/theo-data/theo-rag`): app factory, graceful drain,
  pg-boss LRO, vitest integration pattern.
- `knowledge-base/references/openskills` (parser de frontmatter, M1), `knowledge-base/references/mcp-context-forge` (operação como entidade).

## Objective

Provar a arquitetura ponta a ponta com o menor número de partes móveis, sem reinventar
padrões já validados na casa, deixando os DoDs do ROADMAP M0 todos verdes.

## ADRs

### ADR-1 — Tabela `operations` própria (não o estado nativo do pg-boss)

**Decisão:** modelar `operations(operation_id, skill_id, type, state, error, create_time,
update_time)`; pg-boss carrega só o job.
**Rationale:** o DoD exige `GET /v1/operations/{id}`; a operação é entidade de contrato
público.
**Alternatives considered:** (a) expor `pgboss.job` diretamente — rejeitado: acopla o
contrato público ao schema interno da fila e impede evoluir estados; (b) estado no recurso
(`skills.status`, como theo-rag faz com documents) — rejeitado: o M0 precisa de uma operação
de primeira classe alinhada ao ROADMAP e ao Google Skill Registry.

### ADR-2 — Worker no mesmo processo do server no M0

**Decisão:** registrar `boss.work('create_skill', …)` no boot do server, após `boss.start()`.
**Rationale:** KISS/YAGNI para o walking skeleton; mesmo graceful drain.
**Alternatives considered:** (a) processo `worker.ts` separado (como theo-rag) — rejeitado:
overhead de orquestração sem ganho no M0; é evolução de M2/M8. (b) processar síncrono no
handler sem fila — rejeitado: não prova a LRO, que é o coração do M0.

### ADR-3 — Injeção de dependências em `createApp({ pool, queue })`

**Decisão:** factory recebe `Pool` e `PgBoss` por parâmetro.
**Rationale:** testável via `app.request()` sem socket; DIP.
**Alternatives considered:** (a) singletons globais — rejeitado: quebram testabilidade e
DIP; (b) framework de DI — rejeitado: YAGNI para 2 dependências.

## Drawbacks & Risks

| Risk / Drawback | Mitigation |
|---|---|
| Wiring do graceful drain — ordem errada (pool antes de queue) perde jobs in-flight | Copiar verbatim a ordem server→queue→pool do theo-rag + teste de drain (T3.3) |
| pg-boss v10 API — `createQueue` obrigatório e `work` recebe array de jobs | Blueprint documenta a assinatura exata; teste de integração do worker cobre (T3.2) |
| Acoplamento prematuro ao formato completo de `SKILL.md` | M0 aceita payload mínimo; parser zipado fica para M1 (escopo explícito) |
| Worker no mesmo processo limita escala horizontal | Aceitável no M0; revisitado em M2/M8 (documentado em ADR-2) |

## Unresolved Questions

(none — every decision is resolved at plan time) — todas as decisões de M0 estão fechadas
pelo blueprint e pelos ADRs acima.

## Dependencies

Versões herdadas do theo-rag (mesma casa; sem resolver ranges novos). Todas permissivas e
correntes; nenhuma com CVE conhecido no momento do plano.

| Ecosystem | Package | Version | Scope |
|---|---|---|---|
| npm | hono | ^4.12.25 | api |
| npm | @hono/node-server | ^1.13.0 | api |
| npm | @hono/zod-openapi | ^0.18.0 | api |
| npm | pg-boss | ^10.4.2 | api |
| npm | pg | ^8.13.0 | api + core |
| npm | drizzle-orm | ^0.45.0 | api + core |
| npm | drizzle-kit | ^0.31.0 | core (dev) |
| npm | zod | ^3.25.0 | api + core |
| npm | @opentelemetry/api | ^1.9.1 | api |
| npm | @paralleldrive/cuid2 | ^2.3.1 | api + core |
| npm | vitest | ^4.0.0 | dev |
| npm | typescript | ^5.4.0 | dev |
| npm | tsx | ^4.19.0 | dev |
| npm | @types/node | ^20.0.0 | dev |
| npm | @types/pg | ^8.11.0 | dev |
| npm | eslint | ^9.0.0 | dev |
| npm | typescript-eslint | ^8.0.0 | dev |
| npm | eslint-plugin-import | ^2.30.0 | dev |

## Dependency Graph

```
T1.1 (monorepo+health) ─▶ T2.1 (schema+migrations) ─▶ T2.2 (contracts+skillId)
                                                         │
                                                         ▼
                              T3.1 (stores) ─▶ T3.2 (queue+worker) ─▶ T3.3 (handlers+server+E2E)
```

---

## Phase 1: Foundation

### T1.1 — Monorepo pnpm + TS strict + Hono health

#### Objective
Subir o esqueleto do monorepo (`core`+`api`), TS strict ESM, ESLint flat, e `GET /v1/health`.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** criar `package.json` raiz, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`eslint.config.ts`, scaffolding de `core` e `api`, e um handler de health no Hono.
**Reasoning:** sem a fundação compilando e um endpoint vivo, nenhuma fase posterior tem onde
se apoiar; health é o menor caller real que prova o app factory.

#### Evidence
Blueprint Corner 2 (tsconfig/versões) e a seção de estrutura de arquivos. theo-rag `packages/api/src/server/app.ts`.

#### Files to edit
`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.ts`,
`packages/core/{package.json,tsconfig.json,src/index.ts}`,
`packages/api/{package.json,tsconfig.json,src/server/app.ts,src/server/handlers/health.ts}`,
`packages/api/vitest.contract.config.ts`.

#### Tasks
- Workspace pnpm + tsconfig base strict + eslint flat.
- `createApp()` Hono com rota `GET /v1/health`.

#### TDD
RED: `health.contract.test.ts` — `createApp()` → `app.request('/v1/health')` retorna `200`
e body `{ status: 'ok' }`. GREEN: implementar o handler. REFACTOR: extrair `createApp`.
`test_health_returns_ok` (Given app, When GET /v1/health, Then 200 + {status:ok}).

#### Concurrency tests (only when applicable)
(none — single-threaded) — scaffolding do monorepo e handler de health são stateless e
não compartilham estado mutável.

#### Acceptance Criteria
- `pnpm -r typecheck` passa (0 erros).
- `pnpm --filter @usetheo/skillregistry-api test` verde com o teste de health.
- `GET /v1/health` retorna HTTP 200 e `{"status":"ok"}`.

#### DoD
- [ ] Monorepo compila em TS strict.
- [ ] Teste de health verde.
- [ ] ESLint sem erros.

---

## Phase 2: Persistence & Domain (core)

### T2.1 — Drizzle schema (skills, operations) + migrations + docker-compose

#### Objective
Definir o schema Drizzle de `skills` e `operations`, gerar migrations e subir Postgres local.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** escrever `schema.ts` (tabelas `skills`, `operations`), `drizzle.config.ts`,
gerar migration SQL, criar `docker-compose.yaml` (`ankane/pgvector:v0.5.1`).
**Reasoning:** a persistência é pré-requisito dos stores e do worker; migrations versionadas
garantem reprodutibilidade (não `db:push` cego em prod).

#### Evidence
Blueprint Corner 3 (`drizzle.config.ts`, docker-compose) + ADR-1 (tabela operations).

#### Files to edit
`packages/core/src/infrastructure/db/schema.ts`, `packages/core/drizzle.config.ts`,
`packages/core/src/infrastructure/db/migrations/*`, `docker-compose.yaml`,
`packages/core/package.json` (scripts db:generate/db:push).

#### TDD
RED: `schema.integration.test.ts` (skipIf sem `THEOSKILL_PG_URI`) — após migrate, `SELECT`
em `skills` e `operations` não lança e colunas esperadas existem.
GREEN: schema + migration. `test_migrations_create_skills_and_operations_tables`.

#### Concurrency tests (only when applicable)
(none — single-threaded) — definição de schema/migração não tem concorrência; o acesso
concorrente é coberto em T3.2.

#### Acceptance Criteria
- `pnpm --filter @usetheo/skillregistry db:generate` produz SQL de migration determinístico.
- Com `docker compose up -d pgvector`, a migration aplica sem erro.
- Tabelas `skills(skill_id PK, name, description, state, create_time, update_time)` e
  `operations(operation_id PK, skill_id, type, state, error, create_time, update_time)` existem.

#### DoD
- [ ] Schema + migration commitados.
- [ ] docker-compose sobe pgvector.
- [ ] Teste de migração verde com Postgres.

### T2.2 — Contracts (Zod) + validação de skillId

#### Objective
Definir os contratos públicos (Zod) `SkillInput`, `Skill`, `Operation` e a validação de `skillId`.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** `contract/index.ts` com schemas Zod; `domain/skill-id.ts` com `parseSkillId`.
**Reasoning:** validar na fronteira (fail-fast) antes de qualquer I/O exige o contrato pronto;
`skillId` é a invariante mais sensível (imutável, charset).

#### Evidence
Blueprint Corner 4 e recomendações (alinhamento ao formato Theokit); Google baseline (regras de skillId).

#### Files to edit
`packages/core/src/contract/index.ts`, `packages/core/src/domain/skill-id.ts`,
`packages/core/src/index.ts`.

#### TDD
RED: `skill-id.test.ts` — `parseSkillId('demo-skill')` ok; rejeita `''`, `Gcp-x`, `gcp-x`,
`-x`, `x-`, `A_B`, string > 63. `test_skill_id_rejects_invalid_charset_and_reserved_prefix`.
GREEN: implementar. REFACTOR: mensagens de erro tipadas.

#### Concurrency tests (only when applicable)
(none — single-threaded) — validação de `skillId` e parsing Zod são funções puras, sem
estado compartilhado nem I/O.

#### Acceptance Criteria
- `parseSkillId` aceita IDs válidos e lança `InvalidSkillIdError` (tipado) com mensagem
  contextual em IDs inválidos (vazio, prefixo `gcp-`, charset, limites).
- `SkillInput`/`Skill`/`Operation` parseiam payloads válidos e rejeitam inválidos.

#### DoD
- [ ] Unit tests de skillId e contracts verdes (sem DB).
- [ ] Erros tipados, não strings genéricas.

---

## Phase 3: API & LRO (api)

### T3.1 — Stores Drizzle (skills, operations)

#### Objective
Repositórios de persistência para `skills` e `operations` sobre Drizzle/Pool.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** `skills-store.ts` e `operations-store.ts` com `insert`/`get`/`updateState`.
**Reasoning:** handlers e worker dependem de I/O encapsulado atrás de funções (DIP); isola o
SQL do roteamento.

#### Evidence
Blueprint, estrutura de arquivos (`server/store/*`); theo-rag `server/store/*-pg.ts`.

#### Files to edit
`packages/api/src/server/store/skills-store.ts`, `packages/api/src/server/store/operations-store.ts`.

#### TDD
RED: `stores.integration.test.ts` (skipIf sem DB) — inserir operation `CREATING`, `get`
retorna; `updateState(id,'done')` reflete; inserir skill, `getById` retorna.
`test_operations_store_roundtrip_and_state_transition`.

#### Concurrency tests (only when applicable)
(none — single-threaded) — os stores são funções de I/O sem estado mutável próprio; a
concorrência real (dois jobs sobre o mesmo `skill_id`) é exercida em T3.2.

#### Acceptance Criteria
- `operationsStore.create/get/updateState` e `skillsStore.create/getById` funcionam contra
  Postgres real, com erros de unique mapeados (não vazam stack do driver).

#### DoD
- [ ] Stores cobertos por teste de integração verde.

### T3.2 — Queue (pg-boss) + worker handler `create_skill`

#### Objective
Configurar pg-boss, enfileirar `create_skill` e processar o job (máquina de estados da operação).

#### Why this step (action + reasoning — ReAct discipline)
**Action:** `queue.ts` (`resolveQueue`, `JOB_NAMES`, `createQueue`), `worker.ts`
(`registerWorker` com `boss.work`), handler que valida → INSERT skill → `operations.state=done`
(ou `failed` + `error`).
**Reasoning:** a LRO é o coração do M0; o worker é o ponto de maior risco de concorrência e
de wiring, portanto isolado em sua própria task com testes dedicados.

#### Evidence
Blueprint Corner 4 (Q6 LRO) + ADR-1/ADR-2.

#### Files to edit
`packages/api/src/server/queue/queue.ts`, `packages/api/src/server/worker.ts`,
`packages/api/src/server/queue/graceful-drain.ts`.

#### TDD
RED: `worker.integration.test.ts` (skipIf sem DB) — enfileirar `create_skill` para uma
operation `CREATING`; após processar, `operations.state == 'done'` e a skill existe.
`test_worker_processes_create_skill_marks_operation_done`. Caminho de erro: payload que falha
validação → `operations.state == 'failed'` com `error` preenchido.

#### Concurrency tests (only when applicable)
`test_worker_two_jobs_same_skill_id_one_wins_other_fails`: a **race condition** de dois jobs
**concurrent** com o mesmo `skill_id` — a unique constraint garante que exatamente uma skill
é criada (`done`) e a outra operação termina `failed` (unique violation mapeada), sem linha
órfã. Cobre o **parallel** interleaving real do worker sob carga (pg-boss + Postgres unique
idx); o teste dispara os dois jobs em paralelo e asserta o resultado determinístico. É um
**concurrent test** (race detector ao nível de invariante de unicidade no Postgres).

#### Acceptance Criteria
- `boss.start()` + `createQueue('create_skill')` no boot; `boss.send` enfileira; `boss.work`
  processa array de jobs.
- Sucesso → `operations.state='done'` + skill persistida; erro → `state='failed'` + `error`;
  o handler lança para o pg-boss registrar o job failed (fail-loud).
- Métrica de runtime: log estruturado (`operation_id`, `state`, `duration_ms`) emitido por job.

#### DoD
- [ ] Teste de integração do worker (sucesso, erro, concorrência) verde.
- [ ] Runtime metric (log estruturado) presente.

### T3.3 — Handlers + `createApp` wiring + `server.ts` + E2E

#### Objective
Expor `POST /v1/skills`, `GET /v1/operations/{id}`, `GET /v1/skills/{id}`, montar `createApp`
e o boot `server.ts` com graceful drain, e validar o fluxo E2E.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** handlers de skills/operations; `createApp` registra rotas + `onError`; `server.ts`
inicia pool+boss+worker, serve e instala `setupGracefulDrain` (server→queue→pool, 30s).
**Reasoning:** fecha o circuito fim-a-fim do DoD; o E2E é a prova objetiva de que a
arquitetura funciona (o caller que exercita todas as partes).

#### Evidence
Blueprint Corner 1 (E2E AAA) + Corner 4 (app factory, graceful drain).

#### Files to edit
`packages/api/src/server/handlers/skills.ts`, `packages/api/src/server/handlers/operations.ts`,
`packages/api/src/server/app.ts` (wiring), `packages/api/src/server.ts`,
`packages/api/tests/integration/m0-e2e.integration.test.ts`,
`packages/api/tests/integration/_helpers/{db.ts,env.ts}`.

#### TDD
RED: `m0-e2e.integration.test.ts` (skipIf sem DB) — o teste AAA do blueprint Corner 1:
`POST /v1/skills` → 202 + `operation_id`; poll `GET /v1/operations/{id}` até `done`;
`GET /v1/skills/{id}` → 200 com `name`. `test_create_skill_e2e_create_poll_get`.
Contract (sem DB): `POST /v1/skills` com `skill_id` inválido → 400 tipado;
`GET /v1/skills/inexistente` → 404; `GET /v1/operations/inexistente` → 404.

#### Concurrency tests (only when applicable)
`test_concurrent_post_same_skill_id_one_succeeds`: 10 `POST /v1/skills` **concurrent**
(disparados em **parallel**) com o mesmo `skill_id` — a **race** resolve em exatamente uma
skill `done` e as demais operações `failed` (unique violation), reaproveitando a invariante
exercida no worker (T3.2) pela borda HTTP. É um **parallel test** (concurrent test na borda
HTTP) que asserta a convergência determinística sob a race.

#### Acceptance Criteria
- `POST /v1/skills` retorna `202` + `{ operation_id }`; valida input na fronteira (400 tipado).
- `GET /v1/operations/{id}` retorna `{ state }` (`CREATING|done|failed`); 404 se inexistente.
- `GET /v1/skills/{id}` retorna a skill (200) ou 404.
- `server.ts` instala graceful drain server→queue→pool com deadline 30s.
- E2E criar→poll→get verde contra Postgres real.

#### DoD
- [ ] Todos os endpoints do DoD do ROADMAP M0 funcionando.
- [ ] E2E verde.
- [ ] Graceful drain ordenado + teste de drain.
- [ ] Wiring triad: caller (E2E), integration test, runtime metric (log por operação).

---

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| Monorepo pnpm core+api compila TS strict | T1.1 |
| `GET /v1/health` responde liveness | T1.1 |
| Persistência Postgres+Drizzle com migrations | T2.1 |
| Validação de input na fronteira (skillId/contracts) | T2.2 |
| `POST /v1/skills` enfileira operação via pg-boss | T3.2, T3.3 |
| Worker persiste skill e conclui operação | T3.2 |
| `GET /v1/operations/{id}` reporta done | T3.3 |
| `GET /v1/skills/{id}` retorna skill persistida | T3.1, T3.3 |
| Graceful shutdown ordenado | T3.3 |
| Teste E2E criar→aguardar→obter verde | T3.3 |

Cobertura: 100% das claims do Goal mapeadas a ≥ 1 task.

## Global Definition of Done

- Todos os DoDs por task verdes.
- `pnpm -r typecheck` + `pnpm -r lint` limpos.
- `pnpm -r test` (contract/unit) verde sem DB.
- `pnpm -r test:integration` verde com `docker compose up -d pgvector`.
- `/code-quality` ∉ {FAIL_HARD, INVALID}.
- CHANGELOG `[Unreleased] § Added` atualizado.

## Failure scenarios (when I/O external)

I/O externo: **PostgreSQL** (via `pg`/Drizzle e pg-boss). Cenários cobertos:

| Cenário | Comportamento esperado | Teste |
|---|---|---|
| Postgres indisponível no boot | `server.ts`/`resolveQueue` falha alto com erro claro; processo não sobe "meio vivo" | integração: boot sem DB → erro tipado (ou skipIf documentado) |
| `THEOSKILL_PG_URI` ausente | App contract roda sem DB; integração `skipIf`; server loga e recusa subir worker sem URI | env.ts gate |
| Unique violation em `skill_id` concorrente | Mapeado para 409/`failed` da operação; sem linha órfã | T3.2 concurrency test |
| Skill/operation inexistente | 404 tipado, não 500 | T3.3 contract |
| Erro transitório no worker | Operação `failed` + `error`; job marcado failed no pg-boss (sem retry no M0 — `retryLimit:0`) | T3.2 erro |

## Final Phase: Integration Validation (MANDATORY)

### Execution
1. `docker compose up -d pgvector`.
2. `pnpm install` + `pnpm --filter @usetheo/skillregistry db:push`.
3. `pnpm -r typecheck && pnpm -r lint`.
4. `pnpm -r test` (contract).
5. `THEOSKILL_PG_URI=... pnpm -r test:integration` (inclui o E2E).

### Acceptance Criteria
- Todos os comandos acima exit 0.
- E2E criar→poll→get verde.
- Nenhum símbolo novo sem caller/teste (wiring triad em T3.3).

### If Validation Fails
Loop de validação (`run_validation.py`) corrige a causa-raiz por iteração; não enfraquecer
testes nem baixar thresholds.
