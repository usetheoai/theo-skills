---
slug: m11-workspace-isolation
milestone_id: M11
target_project: theo-skills
created_at: 2026-07-30
goal: Tornar o registry multi-inquilino no dado — Principal resolvido na fronteira, workspace_id primeiro em todo WHERE, skillId único por workspace e acesso cruzado invisível (404) — provado contra Postgres real.
generated_by: to-plan
source: knowledge-base/discoveries/blueprints/m11-workspace-isolation-blueprint.md
---

# Plan: M11 — Isolamento por workspace

## Goal

Introduzir a fronteira de inquilino no modelo de dados e em toda consulta, mantendo a
instalação atual funcionando (ponte legada para o workspace `default`), sem criar nenhuma
superfície nova de spoofing — a autenticação real é M12.

## Baseline Context

Repo @ `98412aa`, pós-M10 (CI verde: 4 workflows).

### Superfície medida a alterar

| Componente | Tamanho | Papel |
|---|---|---|
| `schema.ts` | 6 tabelas (`skills`, `skill_revisions`, `embeddings`, `operations`, `webhook_endpoints`, `webhook_deliveries`) | todas ganham `workspace_id` |
| `skills-store.ts` | 17 operações | maior superfície de consulta |
| `webhook-endpoints-store.ts` | 18 operações | inclui entregas |
| `operations-store.ts` | 7 · `embeddings-store.ts` 6 · `revisions-store.ts` 4 | — |
| `handlers/skills.ts` | 299 LoC | rotas CRUD + revisões |
| `handlers/{retrieve,webhook-endpoints,operations}.ts` | 50 + 78 + 18 | — |
| `retrieve/pg-executor.ts` | SQL da busca híbrida | onde mora o risco de recall |

**Total: 52 operações de banco** que passam a exigir o filtro do inquilino.

### Estado atual crítico

- `skillId: text('skill_id').primaryKey()` (`schema.ts:59`) — **PK global**.
- Índice `embeddings_vector_hnsw` **global**, sem coluna de inquilino.
- `skills_search_tsv_gin` **global**.
- Nenhuma autenticação; `createApp` não conhece o conceito de chamador.

### Glossário

- **Principal** — o que uma credencial resolve: inquilino + quem age + papel + capacidades.
- **Ponte legada** — sem credencial, tudo colapsa no workspace `default` (literal fixo), para a instalação single-tenant continuar funcionando.
- **Pre-filter vs post-filter** — filtrar antes do ANN (recall preservado, índice pode ser abandonado) ou depois (índice usado, recall despenca).

## Prior Art

- Blueprint M11 (7 técnicas + 3 ADRs) — `knowledge-base/discoveries/blueprints/m11-workspace-isolation-blueprint.md`.
- `theo-memory/packages/core/src/domain/principal.ts` — o contrato a espelhar.
- ADR-0021 do theo-memory — a lição de aplicar o vínculo **na fronteira**, não no tipo.

## Coverage Matrix

| # | Afirmação do Goal | Task(s) | Verificação |
|---|---|---|---|
| 1 | Principal resolvido na fronteira | T1.1, T2.1 | tipo no core + porta injetada em `createApp`; nenhum handler lê inquilino do corpo |
| 2 | `workspace_id` primeiro em todo `WHERE` | T3.1–T3.5 | teste varre os stores e reprova consulta sem o filtro |
| 3 | `skillId` único por workspace | T1.2 | PK composta; dois workspaces publicam o mesmo id e coexistem |
| 4 | Acesso cruzado invisível (404) | T4.1 | por id, por revisão, por operação e por busca — todos 404 |
| 5 | Provado contra Postgres real | T4.1, T4.2 | suíte de integração dedicada, hard gate no CI |
| 6 | Instalação atual continua funcionando | T2.2 | migração colapsa dados existentes em `default`; suíte antiga verde sem alteração |
| 7 | Sem superfície nova de spoofing | T2.1 | nenhum header de inquilino é aceito; teste prova que header é ignorado |
| 8 | Busca vetorial mantém as metas de M4 | T5.1 | Recall@5 e p95 medidos com filtro, registrados em ADR |

**Cobertura: 8/8 (100%).**

## Tasks

### Fase 1 — Domínio e schema

#### T1.1 — `Principal`, `Workspace`, `WorkspaceRole` no core

#### Why this step
É o vocabulário do qual tudo depende. Vive em `core/domain` (sem I/O), espelhando o
theo-memory para o ecossistema falar a mesma língua.

#### TDD
```
test_role_satisfies_respeita_ranking:
  owner satisfaz member/admin/owner; member satisfaz só member
test_default_principal_usa_workspace_default_fixo:
  DEFAULT_WORKSPACE_ID é literal estável, não gerado
```

#### T1.2 — `workspace_id` no schema + PK composta

#### Why this step
Sem a coluna, nenhum filtro existe. A PK composta é o que impede um inquilino de bloquear
nome global.

#### TDD
```
test_mesmo_skill_id_em_dois_workspaces_coexiste:
  insere 'deploy-helper' em ws-a e ws-b → duas linhas, sem violação de unicidade
test_indice_unico_lidera_por_workspace:
  o índice de skills tem workspace_id como PRIMEIRA coluna
```

**DoD:** migração em duas fases; `workspace_id` nas 6 tabelas; índices (GIN e HNSW) liderados
pelo inquilino.

### Fase 2 — Fronteira

#### T2.1 — `PrincipalResolver` injetado em `createApp`

#### Why this step
ADR-M11-2: o Principal entra por porta, nunca por header. Aceitar `x-workspace-id` criaria
spoofing trivial.

#### TDD
```
test_header_de_workspace_e_ignorado:
  requisição com x-workspace-id: outro → dado do workspace default, não do outro
test_resolver_ausente_usa_ponte_legada:
  sem resolver → DEFAULT_WORKSPACE_ID
```

#### T2.2 — Migração dos dados existentes

#### TDD
```
test_migracao_colapsa_linhas_existentes_em_default:
  linhas pré-migração recebem workspace_id = default, nenhuma órfã
```

### Fase 3 — Stores (52 operações)

#### T3.1–T3.5 — filtro em `skills`, `revisions`, `embeddings`, `operations`, `webhooks`

#### Why this step
É onde o isolamento vira SQL. Uma consulta esquecida é um vazamento silencioso — por isso
T4.2 varre mecanicamente em vez de confiar em revisão.

#### TDD (por store)
```
test_<store>_nao_le_linha_de_outro_workspace:
  semeia em ws-a e ws-b; consulta como ws-a → só linhas de ws-a
test_<store>_nao_atualiza_nem_deleta_de_outro_workspace:
  update/delete cruzado afeta 0 linhas
```

### Fase 4 — Prova de isolamento

#### T4.1 — Suíte de integração de isolamento (hard gate)

#### Why this step
O theo-memory prova isolamento contra banco real; mock não prova SQL.

#### TDD
```
test_cross_tenant_get_por_id_devolve_404
test_cross_tenant_revisao_devolve_404
test_cross_tenant_operacao_devolve_404
test_cross_tenant_retrieve_nao_devolve_a_skill_do_outro
test_cross_tenant_delete_nao_afeta_o_outro
```

#### T4.2 — Guard mecânico contra consulta sem filtro

#### Why this step
52 operações hoje, mais amanhã. Revisão humana não escala e falha no PR apressado — o mesmo
raciocínio de `tests/workflows/` no M10.

#### TDD
```
test_toda_consulta_de_store_referencia_workspace:
  varre os stores; qualquer .where() sem workspaceId reprova
```

### Fase 5 — Medição do risco

#### T5.1 — Recall e latência com filtro de inquilino

#### Why this step
É o risco declarado do blueprint. **Sem número medido, M11 não fecha.**

**DoD:** Recall@5 e p95 medidos com o filtro ativo, comparados com a baseline sem filtro;
resultado e decisão (iterative scan / índice parcial / pré-filtro FTS) registrados em ADR.

## Dependencies

M10 (CI verde para provar as suítes).

## Drawbacks & Risks

1. **Migração de PK é irreversível na prática** — revisões, embeddings, operações e webhooks referenciam a skill. Mitigação: duas fases, ensaiada contra dump real antes de aplicar.
2. **Recall da busca pode cair com o filtro** — risco central, endereçado por T5.1 com medição.
3. **52 operações mudam de assinatura** — superfície grande de erro por omissão. Mitigação: T4.2 varre mecanicamente.
4. **A ponte legada pode virar porta dos fundos** se alguém a usar em produção achando que autentica. Mitigação: `SECURITY.md` já declara a ausência de auth; M12 fecha.

## Unresolved Questions

1. **pgvector 0.5.1 tem `iterative scan`?** É de 0.8+. Se precisarmos, o bump da imagem entra em T5.1 — decido medindo.

## Test Plan

| Camada | Cobre | Onde |
|---|---|---|
| Unit | `roleSatisfies`, default principal, resolver | co-locado no core |
| Integração | isolamento real por store, 404 cruzado | `tests/integration/workspace-isolation.*` |
| Guard | consulta sem filtro reprova | `tests/integration/` |
| Medição | Recall@5 + p95 com filtro | eval + ADR |

## ADRs

Herdados: ADR-M11-1 (PK composta), ADR-M11-2 (Principal por porta, não header), ADR-M11-3
(índices liderados por `workspace_id`).
