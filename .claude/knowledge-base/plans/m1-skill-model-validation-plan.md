---
slug: m1-skill-model-validation
milestone_id: M1
created_at: 2026-06-22
goal: Modelo de skill + validação rígida (formato Theokit) — parser SKILL.md, validação de payload zip (libs maduras) e CRUD completo com revisões imutáveis.
generated_by: to-plan
source_blueprint: knowledge-base/discoveries/blueprints/m1-skill-model-validation-blueprint.md
---

# Plan: M1 — Skill Model + Rigorous Validation

## Goal

Entregar, sobre o walking skeleton M0, o modelo de skill com o formato `SKILL.md` nativo do
Theokit e validação rígida do payload: um parser de frontmatter (com erro tipado em skill
malformada), um validador de zip seguro (limites, path traversal, symlinks, duplicados,
`SKILL.md` na raiz, secret scan) reusando bibliotecas maduras (não reinventar), e o CRUD
completo (`Create/Get/List paginado/Update updateMask/Delete`) com revisões imutáveis e
reserva de `skillId` pós-delete com janela configurável.

## Context

Segundo milestone do ROADMAP (depende de M0, já entregue como v0.1.0). O M0 trouxe o esqueleto
(Hono + pg-boss LRO + Postgres/Drizzle) com Create mínimo. O M1 transforma a skill num pacote
real validado: ingere o zip do `SKILL.md`, valida na fronteira (fail-fast) e versiona revisões
imutáveis. O blueprint `m1-skill-model-validation` fixou o formato (compatível com o Theokit) e
as libs a reusar (`yauzl`, `gray-matter`, `secretlint`).

## Baseline Context (deep review of current state)

Repo @ git `2d8f830`. M0 existente que M1 estende:

### Files that will be touched

| File | LoC | Estado | Mudança em M1 |
|---|---|---|---|
| `packages/core/src/infrastructure/db/schema.ts` | 34 | existe | + `skill_revisions`; `skills` ganha `latest_revision_id`, `deleted_at`, `reserved_until` |
| `packages/core/src/contract/index.ts` | 46 | existe | + schemas de frontmatter, revisão, paginação |
| `packages/core/src/domain/skill-id.ts` | 50 | existe | reusado (validação de skillId) |
| `packages/api/src/server/handlers/skills.ts` | 65 | existe | Create valida payload na fronteira; + Update/Delete/List/revisions |
| `packages/api/src/server/worker.ts` | 63 | existe | handler `create_skill` persiste revisão; + `update_skill` |
| `packages/api/src/server/store/skills-store.ts` | 52 | existe | + latest_revision, soft-delete, reserva, list paginado |
| `packages/api/src/server/store/operations-store.ts` | 62 | existe | reusado |
| `packages/api/src/server/queue/queue.ts` | 22 | existe | + job `update_skill` |
| `packages/api/src/server/app.ts` | 41 | existe | registra novas rotas + injeta validators |

### New files (M1)

`core/src/domain/frontmatter.ts`, `core/src/domain/payload-validator.ts` (port),
`core/src/domain/secret-scanner.ts` (port), `core/src/domain/limits.ts`,
`api/src/server/payload/yauzl-validator.ts` (adapter),
`api/src/server/payload/secretlint-scanner.ts` (adapter),
`api/src/server/store/revisions-store.ts`, e os handlers/rotas novas.

### Current callers / dependents

Nenhum consumidor externo ainda (Theokit provider é M7). O contrato HTTP `/v1/skills` do M0
evolui; como não há release público consumindo o payload, a mudança é aditiva e segura.

### Domain glossary

| Termo | Definição |
|---|---|
| Frontmatter | Bloco YAML `---...---` no topo do `SKILL.md` (campos name/description/…). |
| Revisão | Snapshot imutável `{revision_id, payload, content_hash, frontmatter}` de uma skill. |
| content_hash | sha256 do zip (integridade + dedup). |
| Reserva de skillId | Janela pós-delete em que o id não pode ser recriado (`THEOSKILL_ID_RESERVATION_HOURS`). |
| PayloadValidator / SecretScanner | Ports de domínio (DIP); adapters yauzl/secretlint na infra. |

### Architecture boundaries affected

`core` define os ports `PayloadValidator` e `SecretScanner` e a lógica pura (frontmatter,
limites); `api/infrastructure` implementa os adapters (yauzl, secretlint). Handlers validam na
fronteira e delegam; worker persiste. Sem object storage, sem Redis (constraint do ROADMAP).

## Prior Art & Related Work

- Blueprint `m1-skill-model-validation` (libs + formato + guardas).
- Peers: `knowledge-base/references/openskills` (anti-padrão regex YAML — NÃO copiar),
  `knowledge-base/references/agentskills-spec` (regras formais), `knowledge-base/references/anthropic-skills` (template/validador).
- Consumidor-alvo: `theokit-sdk` (interface `Skill`).

## Objective

Implementar M1 reusando libs maduras, validando na fronteira (fail-fast) e versionando
revisões imutáveis, deixando todos os DoDs do ROADMAP M1 verdes.

## ADRs

### ADR-1 — Validação síncrona na fronteira (fail-fast), não no worker

**Decisão:** o handler valida o payload (frontmatter + zip-safety + secret scan) de forma
síncrona e retorna `400` tipado em qualquer violação, antes de enfileirar; o worker só
persiste a revisão validada.
**Rationale:** PRD §5.4 + Unbreakable Rule 8.
**Alternatives considered:** (a) validar no worker e terminar a operação como `failed` —
rejeitado: atrasa o feedback de erro do cliente e cria operações lixo; (b) validação parcial
na fronteira e resto no worker — rejeitado: divide a lógica e duplica regras.

### ADR-2 — Reusar libs maduras (yauzl/gray-matter/secretlint), não reinventar

**Decisão:** `yauzl` (zip-safety por metadados, sem descompactar), `yaml` (eemeli, ISC) +
split manual de frontmatter, `@secretlint/core` + preset-recommend (secret scan in-memory).
NB: a escolha do parser YAML mudou de `gray-matter` para `yaml` durante o `/deps-audit` —
`gray-matter` fixa `js-yaml` 3.x, que carrega a CVE GHSA-h67p-54hq-rp68 (DoS quadrático em
merge keys), sem caminho de upgrade seguro; `yaml` (eemeli) é outra implementação, sem a CVE,
zero-dep e mantida — relevante porque o frontmatter vem de payload não-confiável.
**Rationale:** Unbreakable Rule 9; openskills usa regex YAML (anti-padrão).
**Alternatives considered:** (a) parser/regex caseiro — rejeitado: frágil e inseguro;
(b) `adm-zip` — rejeitado: descompacta tudo em memória, histórico de Zip-Slip;
(c) shell-out a gitleaks no caminho da request — rejeitado: binário no container; gitleaks
fica para o `/loop-security-audit` de repo inteiro.

### ADR-3 — Revisões imutáveis com content-hash; payload em bytea

**Decisão:** `skill_revisions` nunca sofre UPDATE; Update de payload cria nova revisão e move
`latest_revision_id`.
**Rationale:** PRD §4.2/§5.2; alinhado ao M0 (sem object storage).
**Alternatives considered:** (a) mutar a revisão atual — rejeitado: perde histórico/auditoria;
(b) mover blobs para object storage — rejeitado: fora da stack da casa (YAGNI no M1).

### ADR-4 — Preservar campos desconhecidos do frontmatter (forward-compat)

**Decisão:** guardar o frontmatter completo (jsonb) e validar só campos conhecidos + limites.
**Rationale:** o Theokit evolui o frontmatter (hooks/paths/effort); rejeitar campos novos
quebraria skills válidas.
**Alternatives considered:** allow-list estrita (como o AgentSkills) — rejeitado: frágil
contra a evolução do formato Theokit.

### ADR-5 — Reserva de skillId configurável; Delete síncrono

**Decisão:** reserva via `THEOSKILL_ID_RESERVATION_HOURS` (default 24); `Delete` é síncrono
(tombstone `DELETED` + `reserved_until`), pois é uma operação barata de metadados.
**Rationale:** ROADMAP pede janela configurável (não 24h fixos); só operações com payload
(Create/Update) justificam a LRO.
**Alternatives considered:** (a) 24h fixos — rejeitado pelo ROADMAP; (b) Delete via LRO —
rejeitado: overhead sem ganho para uma mudança de estado barata.

## Drawbacks & Risks

| Risk / Drawback | Mitigation |
|---|---|
| Validação de zip frouxa permite payload perigoso (zip-bomb, traversal, symlink) | Guardas via metadados da central directory (yauzl), nunca descompactar entry que falhe; teste por guarda com fixtures em memória |
| API do `secretlint` programático diverge do esperado | Spike isolado na T2.2 fixando a API exata antes de integrar; adapter atrás do port `SecretScanner` (troca sem tocar domínio) |
| Divergência sutil do frontmatter quebra a integração futura com o Theokit (M7) | Campos obrigatórios (name+description) e união de opcionais conforme o blueprint; preservar desconhecidos (ADR-4) |
| Payload em bytea pressiona o Postgres conforme as skills crescem | `content_hash` para dedup; limites de tamanho na fronteira; object storage avaliado pós-V1 (documentado) |
| Update concorrente da mesma skill cria revisões conflitantes | `latest_revision_id` atualizado atomicamente; teste de concorrência (parallel test) garantindo convergência |

## Unresolved Questions

(none — every decision is resolved at plan time) — formato, libs, guardas, modelo de revisão
e reserva estão fixados no blueprint e nos ADRs acima.

## Dependencies

Novas dependências (todas MIT, mantidas; sem CVE conhecido no momento do plano). Versões
verificadas via web research no blueprint.

| Ecosystem | Package | Version | Scope |
|---|---|---|---|
| npm | yauzl | ^3.3.0 | api (zip-safety) |
| npm | @types/yauzl | ^2.10.3 | api (dev) |
| npm | yaml (eemeli) | ^2.8.4 | core (frontmatter; substitui gray-matter por CVE no js-yaml 3.x) |
| npm | @secretlint/core | ^11.3.1 | api (secret scan) |
| npm | @secretlint/secretlint-rule-preset-recommend | ^11.3.1 | api (secret rules) |

Herdadas do M0 (sem mudança): hono, pg-boss, pg, drizzle-orm, drizzle-kit, zod,
@paralleldrive/cuid2, vitest, typescript, tsx, eslint, typescript-eslint.

## Dependency Graph

```
T1.1 (frontmatter) ─┐
T2.1 (zip-validator) ┼─▶ T2.2 (secret-scanner) ─▶ T3.1 (schema) ─▶ T3.2 (stores)
                     │                                                  │
                     └──────────────────────────────────────────────▶  ▼
        T4.1 (Create+worker) ─▶ T4.2 (Get/List/Delete) ─▶ T4.3 (Update) ─▶ T4.4 (revisions)
```

---

## Phase 1: Frontmatter (core)

### T1.1 — Parser de frontmatter SKILL.md (Theokit-compatível)

#### Objective
`parseFrontmatter(raw)` que extrai e valida o frontmatter YAML, com erro tipado em malformado.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** `core/src/domain/frontmatter.ts` com split manual de `---...---` + `yaml` (eemeli)
`parse`, validação de `name` (charset/≤64) e `description` (não-vazio/≤1024), preservação de campos desconhecidos,
`SkillFrontmatterError` tipado (códigos `missing_frontmatter`/`schema_invalid`).
**Reasoning:** é a unidade pura mais sensível (compatibilidade com o Theokit) e pré-requisito da
validação de payload; sem ela, nada do CRUD com payload fecha.

#### Evidence
Blueprint Corner 4 (campos Theokit) e Corner 2 (gray-matter). agentskills-spec validator (limites).

#### Files to edit
`packages/core/src/domain/frontmatter.ts`, `packages/core/src/contract/index.ts`, `packages/core/src/index.ts`.

#### TDD
RED: `frontmatter.test.ts` — rejeita sem frontmatter (`missing_frontmatter`), sem `description`
(`schema_invalid`), `name` > 64 / charset inválido / hífen no início-fim; aceita a união Theokit
e preserva campos desconhecidos. `test_frontmatter_rejects_missing_description_and_invalid_name`.
GREEN: implementar. REFACTOR: extrair limites para `limits.ts`.

#### Concurrency tests (only when applicable)
(none — single-threaded) — parsing de frontmatter é função pura, sem estado nem I/O.

#### Acceptance Criteria
- `parseFrontmatter` aceita `{name, description}` + opcionais e preserva desconhecidos.
- Lança `SkillFrontmatterError` tipado (com `code`) em cada caso malformado.
- Limites AgentSkills aplicados: assert que `name.length <= 64` e `description.length <= 1024` (`toThrow` quando excedido).

#### DoD
- [ ] `pnpm --filter @usetheo/skillregistry test` retorna `exit 0` com os testes do parser verdes (sem I/O).
- [ ] Cada caso malformado lança `SkillFrontmatterError` com `code` definido (assert `toThrow`), não string genérica.

---

## Phase 2: Payload validation (core ports + infra adapters)

### T2.1 — PayloadValidator (port) + adapter yauzl (zip-safety)

#### Objective
Validar o zip por metadados (sem descompactar entry perigoso) e extrair `SKILL.md` + content_hash.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** port `PayloadValidator` no `core`; adapter `yauzl-validator.ts` na api usando
`yauzl.fromBuffer`; guardas (itens/tamanho/ratio/profundidade, `..`/abs path, symlink via
external attrs, duplicados, `SKILL.md` na raiz); `content_hash` via `node:crypto`. Erro tipado
`PayloadValidationError` com `code` por guarda.
**Reasoning:** é o ponto de maior risco de segurança (zip-bomb/traversal); isolá-lo atrás de um
port permite testar cada guarda e trocar a lib sem tocar o domínio.

#### Evidence
Blueprint Corner 4 (guardas + API yauzl) e Corner 2 (yauzl). PRD §5.4. Google baseline (limites).

#### Files to edit
`packages/core/src/domain/payload-validator.ts`, `packages/core/src/domain/limits.ts`,
`packages/api/src/server/payload/yauzl-validator.ts`.

#### TDD
RED: `yauzl-validator.integration.test.ts` — fixtures de zip em memória: válido (passa, extrai
SKILL.md + hash), traversal (`../x`), symlink (external attrs), ratio alto (zip-bomb), profundidade
> 8, item duplicado, sem `SKILL.md` na raiz → cada um lança `PayloadValidationError` com o `code`
certo. `test_zip_guards_reject_traversal_symlink_bomb_and_missing_skillmd`.
GREEN: implementar com yauzl. REFACTOR: guardas como funções nomeadas.

#### Concurrency tests (only when applicable)
(none — single-threaded) — validação de um buffer é stateless; nenhuma corrida.

#### Acceptance Criteria
- Cada guarda rejeita o payload correspondente com `PayloadValidationError` tipado.
- Nunca descompacta (`openReadStream`) um entry que falhe uma guarda (zip-bomb safe).
- Para um zip válido, retorna `{ skillMd, frontmatterRaw, contentHash, entryCount }`.

#### DoD
- [ ] `pnpm test:integration` retorna `exit 0`: um teste por guarda que assert `PayloadValidationError.code`.
- [ ] `contentHash` equals o sha256 do buffer (assert `equals` para um zip idêntico).

### T2.2 — SecretScanner (port) + adapter secretlint

#### Objective
Escanear o conteúdo textual das entries por segredos, in-memory, sem escrever em disco.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** port `SecretScanner` no `core`; adapter `secretlint-scanner.ts` usando
`@secretlint/core` + preset-recommend sobre as strings das entries de texto; retorna findings
(tipo + localização, sem expor o valor). Bloqueia o payload se houver finding.
**Reasoning:** segredo vazado num skill público é incidente de segurança; reusar ruleset curado
(não regex caseiro) é Unbreakable Rule 9.

#### Evidence
Blueprint Corner 2 (secretlint) e Recommendations.

#### Files to edit
`packages/core/src/domain/secret-scanner.ts`, `packages/api/src/server/payload/secretlint-scanner.ts`.

#### TDD
RED: `secretlint-scanner.integration.test.ts` — conteúdo com uma chave AWS/privada fake →
finding (bloqueia); conteúdo limpo → sem finding. `test_secret_scanner_flags_aws_key_passes_clean`.
GREEN: fixar a API exata do secretlint e implementar. REFACTOR: nunca logar o valor do segredo.

#### Concurrency tests (only when applicable)
(none — single-threaded) — escaneia buffers em memória, sem estado compartilhado.

#### Acceptance Criteria
- Conteúdo com segredo conhecido produz finding e bloqueia o payload (400/`code=secret_detected`).
- Assert que o response e os logs não `contains` o valor do segredo (somente `type` + `file` são retornados).

#### DoD
- [ ] Conteúdo com `AKIA...` (chave fake) retorna ≥ `1` finding e conteúdo limpo retorna `0` findings (assert).

---

## Phase 3: Persistence (core schema + api stores)

### T3.1 — Schema de revisões + reserva + migration

#### Objective
`skill_revisions` imutável + colunas de reserva em `skills`; migration determinística.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** `schema.ts` ganha `skill_revisions(revision_id PK, skill_id, payload bytea,
content_hash, frontmatter jsonb, create_time)`; `skills` ganha `latest_revision_id`,
`deleted_at`, `reserved_until`; `drizzle-kit generate`; aplicar.
**Reasoning:** stores e worker dependem do schema; revisão imutável é o coração de M1.

#### Evidence
Blueprint Corner 4 (Q6) e ADR-3/ADR-5.

#### Files to edit
`packages/core/src/infrastructure/db/schema.ts`, `packages/core/src/infrastructure/db/migrations/*`.

#### TDD
RED: `schema.integration.test.ts` (estende o do M0) — após migrate, `skill_revisions` e as novas
colunas de `skills` existem. `test_migration_adds_revisions_and_reservation_columns`.
GREEN: schema + migration.

#### Concurrency tests (only when applicable)
(none — single-threaded) — definição de schema não tem concorrência (acesso concorrente em T3.2/T4.3).

#### Acceptance Criteria
- `drizzle-kit` aplica a migration com `exit 0`; assert que `skill_revisions` consta no `information_schema.columns`.
- `skill_revisions` sem caminho de UPDATE (imutável por convenção + teste de store que assert `toThrow`).

#### DoD
- [ ] Migration commitada e aplicada (`drizzle-kit generate` produz SQL determinístico).
- [ ] `pnpm test:integration` verde: `information_schema.columns` contains `skill_revisions` + as novas colunas (assert).

### T3.2 — Stores: revisions + skills (latest, list paginado, soft-delete, reserva)

#### Objective
Repositórios para criar revisão, mover `latest_revision_id`, listar paginado, soft-delete com reserva.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** `revisions-store.ts` (create, getById, listBySkill); `skills-store` estendido
(createWithRevision atômico, getLatest, listPaginated com page_size/page_token, softDelete +
reserva, isReserved). Tudo via Drizzle.
**Reasoning:** encapsula o I/O (DIP) e a atomicidade da criação skill+revisão.

#### Evidence
Blueprint Corner 4 (Q6). Stores do M0 (`store/*-store.ts`).

#### Files to edit
`packages/api/src/server/store/revisions-store.ts`, `packages/api/src/server/store/skills-store.ts`.

#### TDD
RED: `revisions-store.integration.test.ts` — criar skill+revisão move `latest_revision_id`;
segunda revisão (update) move de novo e mantém a anterior recuperável; soft-delete marca
`reserved_until`; `isReserved` true dentro da janela, false após; list paginado retorna page_token.
`test_revision_lifecycle_and_reservation_window`.
GREEN: implementar.

#### Concurrency tests (only when applicable)
`test_concurrent_create_same_skill_id_one_wins`: dois `createWithRevision` **concurrent** com o
mesmo `skill_id` — a unique constraint resolve a **race** em exatamente uma skill criada (a outra
`failed`), sem revisão órfã. É um **concurrent test** (race detector via unicidade no Postgres).

#### Acceptance Criteria
- `createWithRevision` é atômico (skill + revisão 1 numa transação); falha não deixa órfão.
- `getLatest` retorna a revisão corrente; revisões antigas permanecem recuperáveis.
- `listPaginated` é determinístico e retorna `next_page_token`.
- `softDelete` marca `DELETED` + `reserved_until`; `isReserved` respeita a janela configurável.

#### DoD
- [ ] Testes de integração de revisões + reserva + paginação verdes.

---

## Phase 4: API CRUD + LRO (api)

### T4.1 — Create ingere + valida payload (fronteira 400) + worker persiste revisão

#### Objective
`POST /v1/skills` valida o payload na fronteira e, se válido, enfileira; o worker cria skill + revisão 1.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** o handler decodifica base64, roda frontmatter + zip-validator + secret-scanner →
`400` tipado em violação; cria operação + enfileira `create_skill` com o manifesto validado;
worker faz `createWithRevision`. Injetar os validators via `createApp` (DIP).
**Reasoning:** fecha o fluxo de ingestão real (o núcleo do M1) com fail-fast na fronteira (ADR-1).

#### Evidence
Blueprint Corner 1 (E2E) e ADR-1. M0 `handlers/skills.ts` + `worker.ts`.

#### Files to edit
`packages/api/src/server/handlers/skills.ts`, `packages/api/src/server/worker.ts`,
`packages/api/src/server/queue/queue.ts`, `packages/api/src/server/app.ts`, `packages/api/src/server/wiring.ts`.

#### TDD
RED: `m1-create-e2e.integration.test.ts` — POST com zip válido → 202 → poll done → GET skill com
revisão; POST com zip inválido (sem SKILL.md / traversal / sem description / secret) → 400 tipado
e nenhuma operação criada. `test_create_with_payload_validates_at_boundary_and_persists_revision`.
GREEN: implementar.

#### Concurrency tests (only when applicable)
`test_concurrent_create_same_skill_id_http`: N `POST /v1/skills` **concurrent** (em **parallel**)
com o mesmo `skill_id` — a **race** resolve em uma skill `done` e as demais `failed`. **concurrent
test** na borda HTTP.

#### Acceptance Criteria
- Payload inválido → `400` tipado (frontmatter/zip/secret), sem operação criada.
- Payload válido → `202` + `operation_id`; worker cria skill + revisão 1; `GET` retorna a skill.
- Métrica de runtime: log estruturado por operação (reusa M0).

#### DoD
- [ ] E2E de create (válido + cada inválido) verde.
- [ ] Validators injetados via `createApp` (DIP).

### T4.2 — Get (latest), List (paginado), Delete (sync, reserva)

#### Objective
`GET /v1/skills/{id}`, `GET /v1/skills` (paginado), `DELETE /v1/skills/{id}` (síncrono + reserva).

#### Why this step (action + reasoning — ReAct discipline)
**Action:** Get retorna skill + metadados da revisão corrente (404 se inexistente/DELETED); List
paginado (`page_size`+`page_token`, exclui DELETED); Delete marca DELETED + `reserved_until` (200).
**Reasoning:** completa o R do CRUD (read/list) e o D (delete) com a semântica de reserva (ADR-5).

#### Evidence
Blueprint Corner 4 (Q6) e ADR-5. PRD §5.3.

#### Files to edit
`packages/api/src/server/handlers/skills.ts`, `packages/api/src/server/app.ts`.

#### TDD
RED: `m1-read-delete-e2e.integration.test.ts` — List paginado retorna page_token e respeita
page_size; Get de skill DELETED → 404; após Delete, Create do mesmo id dentro da janela → 409
reserved; fora da janela → permitido. `test_list_pagination_delete_reservation_window`.
GREEN: implementar.

#### Concurrency tests (only when applicable)
(none — single-threaded) — leituras e o delete (uma escrita de estado) não compartilham estado
mutável entre si; a corrida de recriação é coberta em T4.1.

#### Acceptance Criteria
- `List` paginado determinístico; exclui DELETED; `next_page_token` correto.
- `Get` de skill inexistente/DELETED → 404.
- `Delete` marca reserva; recriação dentro da janela → 409; fora → permitido.

#### DoD
- [ ] E2E de read/list/delete + reserva verde.

### T4.3 — Update (updateMask, LRO, nova revisão no payload)

#### Objective
`PATCH /v1/skills/{id}` com `updateMask` ∈ {displayName, description, zippedFilesystem}.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** valida o payload na fronteira se `zippedFilesystem` presente (400); enfileira
`update_skill`; worker atualiza metadados e, se houver payload, cria nova revisão e move
`latest_revision_id`. Só os campos do `updateMask` mudam.
**Reasoning:** completa o U do CRUD com revisões imutáveis (nova revisão por payload).

#### Evidence
Blueprint ADR-3 (revisões). Google baseline (updateMask). M0 worker.

#### Files to edit
`packages/api/src/server/handlers/skills.ts`, `packages/api/src/server/worker.ts`,
`packages/api/src/server/queue/queue.ts`.

#### TDD
RED: `m1-update-e2e.integration.test.ts` — Update só de description (sem nova revisão); Update com
payload → nova revisão, `latest_revision_id` movido, revisão anterior recuperável; updateMask
ignora campos não-listados. `test_update_mask_metadata_and_payload_creates_new_revision`.
GREEN: implementar.

#### Concurrency tests (only when applicable)
`test_concurrent_update_same_skill_converges`: dois `PATCH` **concurrent** (em **parallel**) com
payloads diferentes — a **race** converge para um `latest_revision_id` consistente (uma das
revisões vence), sem estado corrompido. **concurrent test** sobre `latest_revision_id`.

#### Acceptance Criteria
- `updateMask` altera apenas os campos listados.
- Update com payload cria nova revisão imutável e move `latest_revision_id`.
- Update concorrente converge sem corromper `latest_revision_id`.

#### DoD
- [ ] E2E de update (metadata-only, payload, updateMask) + concorrência verde.

### T4.4 — List revisions + Get revision

#### Objective
`GET /v1/skills/{id}/revisions` e `GET /v1/skills/{id}/revisions/{revisionId}`.

#### Why this step (action + reasoning — ReAct discipline)
**Action:** handlers que listam as revisões de uma skill (mais recentes primeiro) e retornam uma
revisão específica (metadados; payload sob demanda). 404 adequado.
**Reasoning:** completa a história de revisões imutáveis exposta no contrato (PRD §5.3).

#### Evidence
PRD §5.3 (endpoints de revisão). Blueprint Corner 4 (Q6).

#### Files to edit
`packages/api/src/server/handlers/skills.ts`, `packages/api/src/server/app.ts`.

#### TDD
RED: `m1-revisions-e2e.integration.test.ts` — após 2 updates, List revisions retorna 3 revisões em
ordem; Get revision por id retorna a correta; revision inexistente → 404.
`test_list_and_get_revisions`.
GREEN: implementar.

#### Concurrency tests (only when applicable)
(none — single-threaded) — leituras de revisão não compartilham estado mutável.

#### Acceptance Criteria
- `List revisions` retorna todas as revisões da skill, ordenadas.
- `Get revision` retorna a revisão por id; inexistente → 404.

#### DoD
- [ ] E2E de revisões verde.

---

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| Parser de frontmatter SKILL.md (Theokit) + erro tipado | T1.1 |
| Validação de zip (limites/traversal/symlink/dup/SKILL.md raiz) | T2.1 |
| Secret scan no payload | T2.2 |
| Revisões imutáveis (modelo + content_hash) | T3.1, T3.2 |
| Create com payload validado na fronteira | T4.1 |
| Get + List paginado | T4.2 |
| Delete + reserva de skillId (janela configurável) | T4.2 |
| Update (updateMask) com nova revisão no payload | T4.3 |
| List/Get revisions | T4.4 |
| skillId validado (charset/imutável) | T1.1/T4.1 (reusa M0 `skill-id.ts`) |

Cobertura: 100% das claims do Goal mapeadas a ≥ 1 task.

## Global Definition of Done

- Todos os DoDs por task verdes.
- `pnpm -r typecheck` + `pnpm -r lint` (0/0) limpos.
- `pnpm -r test` (contract/unit) verde sem DB.
- `pnpm -r test:integration` verde com `docker compose up -d pgvector`.
- `/code-quality` ∉ {FAIL_HARD, INVALID}.
- CHANGELOG `[Unreleased]` atualizado.
- `/deps-audit` sem CVE crítico nas novas deps.

## Failure scenarios (when I/O external)

I/O externo: **PostgreSQL** + parsing de **payload não-confiável** (zip do usuário).

| Cenário | Comportamento esperado | Teste |
|---|---|---|
| Zip malformado / não é zip | `400` tipado (`code=invalid_zip`), sem operação | T4.1 |
| Path traversal / symlink / zip-bomb / dup / sem SKILL.md | `400` tipado por guarda; nunca descompacta entry perigoso | T2.1 |
| Frontmatter ausente / sem description / name inválido | `400` tipado (`missing_frontmatter`/`schema_invalid`) | T1.1/T4.1 |
| Secret detectado no payload | `400` (`code=secret_detected`); valor nunca logado | T2.2 |
| Create de skillId reservado (delete recente) | `409` reserved | T4.2 |
| Update concorrente da mesma skill | converge para `latest_revision_id` consistente | T4.3 |
| Postgres indisponível | falha alta no boot/worker; operação `failed` em erro transitório do worker | herdado do M0 |

## Final Phase: Integration Validation (MANDATORY)

### Execution
1. `docker compose up -d pgvector` (ou container na porta 5435).
2. `pnpm install` + aplicar migration.
3. `pnpm -r typecheck && pnpm -r lint`.
4. `pnpm -r test` (contract).
5. `THEOSKILL_PG_URI=... pnpm -r test:integration` (inclui os E2E de M1).

### Acceptance Criteria
- Todos os comandos exit 0.
- Cada guarda de validação coberta por teste.
- Nenhum símbolo novo sem caller/teste (wiring triad).

### If Validation Fails
Loop de validação corrige a causa-raiz por iteração; nunca enfraquecer testes nem baixar
thresholds, nunca reverter para regex/lib insegura.
