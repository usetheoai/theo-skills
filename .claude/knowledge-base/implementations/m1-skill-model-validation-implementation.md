---
slug: m1-skill-model-validation
milestone_id: M1
completed_at: 2026-06-23
plan: knowledge-base/plans/m1-skill-model-validation-plan.md
status: IMPLEMENTATION_COMPLETE
---

# Implementation — M1 Skill Model + Rigorous Validation

Todos os DoDs do ROADMAP M1 e critérios de aceite do plano verdes, reusando libs maduras
(sem reinventar) e validando na fronteira (fail-fast).

## DoD do ROADMAP M1

- [x] Parser de frontmatter `SKILL.md` compatível com o Theokit + erro tipado em malformada
  (`core/domain/frontmatter.ts`, `yaml`/eemeli; required name+description; limites; preserva desconhecidos).
- [x] Validação de payload zip (limites/traversal/symlink/ratio/profundidade/dup/SKILL.md raiz)
  + secret scan (`yauzl-validator.ts` + `zip-guards.ts` puras + `secretlint-scanner.ts`).
- [x] CRUD completo + revisões imutáveis; skillId validado e reservado pós-delete (janela configurável).

## Tasks & wiring triad

| Task | Caller (prod) | Test | Runtime metric |
|---|---|---|---|
| T1.1 frontmatter | handler ingest | `frontmatter.test.ts` | — (pure) |
| T2.1 zip validator | handler ingest | `zip-guards` + `yauzl-validator` contract | — |
| T2.2 secret scan | handler ingest | `secretlint-scanner` contract | log de findings (sem valor) |
| T3.1 schema | stores | `schema.integration` | — |
| T3.2 stores | handlers + worker | `skills-store.integration` | — |
| T4.1 create | `POST /v1/skills` → worker | `m1-e2e` | log por operação |
| T4.2 get/list/delete | rotas | `m1-e2e` | log de delete/reserva |
| T4.3 update | `PATCH` → worker | `m1-e2e` | log de update |
| T4.4 revisions | rotas | `m1-e2e` | — |

## Decisões-chave

- **Validação na fronteira (fail-fast, ADR-1):** payload validado síncrono no handler → 400/409
  tipado; worker só persiste. Diferente do Google (operação FAILED).
- **Não reinventar (ADR-2):** `yauzl` (zip-safety por metadados, zip-bomb safe), `yaml` (eemeli),
  `secretlint`. Troca de `gray-matter`→`yaml` por CVE no js-yaml 3.x (deps-audit).
- **Revisões imutáveis (ADR-3):** `skill_revisions` nunca sofre UPDATE; payload bytea + sha256.
- **Forward-compat (ADR-4):** frontmatter completo preservado (jsonb).
- **Reserva configurável (ADR-5):** `THEOSKILL_ID_RESERVATION_HOURS`; Delete síncrono.

## Gates

typecheck PASS · lint 0/0 · contract 39 · integração 14 (Postgres real) · build PASS ·
deps-audit clean (CVE resolvido) · code-quality PASS
(`knowledge-base/audits/m1-skill-model-validation-code-quality-2026-06-23.md`).

## Limitação conhecida (documentada)

A guarda de zip lê **todos** os entries de texto em memória para o secret scan (limitada pelos
limites de tamanho já aplicados). Para skills muito grandes, escanear só por extensão de texto é
otimização futura (M8). Documentado; não afeta correção.
