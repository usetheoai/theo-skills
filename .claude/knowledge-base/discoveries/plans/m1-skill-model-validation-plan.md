---
slug: m1-skill-model-validation
version: 0.1.0
owner: plataforma-theo
created_at: 2026-06-22
status: ready-for-execute
generated_by: discover-plan
---

# Discovery Plan — M1 Skill Model + Rigorous Validation

## Context

ROADMAP M1 exige: parser de frontmatter `SKILL.md` compatível com o Theokit, validação
rígida de payload zip (limites, path traversal, symlinks, duplicados, `SKILL.md` na raiz,
secret scan) e CRUD completo com revisões imutáveis. Antes de codar, esta investigação fixa
(a) o formato exato que o Theokit parseia e (b) as bibliotecas maduras a reusar para zip,
YAML e secret-scan (Unbreakable Rule 9 — não reinventar; openskills usa um regex YAML caseiro
que é o anti-padrão a evitar).

## Objective

Blueprint que permita implementar M1 sem decisões em aberto: formato de skill (união de
campos Theokit + AgentSkills), regras de validação de zip, abordagem de secret-scan, e modelo
de revisões imutáveis + reserva de skillId.

## In-scope / Out-of-scope

### knowledge-base/references/openskills — loader TS de SKILL.md
- **In scope:** `src/utils/yaml.ts`, `src/utils/skills.ts` (parsing e estrutura de pasta).
- **Out of scope:** CLI commands, prompts interativos.

### knowledge-base/references/agentskills-spec — spec formal
- **In scope:** `docs/specification.mdx`, `skills-ref/src/skills_ref/validator.py`, `models.py`.
- **Out of scope:** tooling Python de build.

### knowledge-base/references/anthropic-skills — repo canônico
- **In scope:** `template/SKILL.md`, `skills/skill-creator/scripts/quick_validate.py`.
- **Out of scope:** skills de exemplo individuais.

### Theokit (`/home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk`) — consumidor-alvo
- **In scope:** `packages/sdk/src/internal/runtime/skills/{discover-skills,skill-frontmatter,yaml-frontmatter}.ts`.
- **Out of scope:** runtime de execução de agente.

## ADRs (como investigar)

- **ADR-D1 — Theokit é o contrato de compatibilidade.** O formato retornado pelo registry
  deve casar com a interface `Skill` do SDK e o que `parseSkillFrontmatter` exige (campo
  `description` obrigatório). Time-budget: 2h.
- **ADR-D2 — Reusar libs maduras, não reinventar.** Avaliar yauzl/gray-matter/secretlint
  (licença permissiva + manutenção) em vez de regex caseiro (anti-padrão do openskills).
- **ADR-D3 — Validação na fronteira (fail-fast).** Por PRD §5.4, validar o zip de forma
  síncrona no POST (400 tipado), não só no worker.

## Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | Integration tests | Como o agentskills-spec testa a validação de SKILL.md (campos obrigatórios, limites, nomes inválidos)? | Read `knowledge-base/references/agentskills-spec/skills-ref/src/skills_ref/validator.py` + testes | Lista de regras testadas + shape do teste |
| Q2 | Dependencies | Quais libs npm maduras (licença permissiva) para (a) zip-safety, (b) YAML frontmatter, (c) secret-scan? Versões? | Web + `knowledge-base/references/openskills/package.json` | Tabela package→versão→licença→motivo |
| Q3 | Tools | Como validar uma skill localmente (anthropic skill-creator)? Que comando/checks? | Read `knowledge-base/references/anthropic-skills/skills/skill-creator/scripts/quick_validate.py` | Lista de checks da CLI de validação |
| Q4 | Techniques | Qual o frontmatter exato que o Theokit parseia e quais campos são obrigatórios? | Read `theokit-sdk/packages/sdk/src/internal/runtime/skills/skill-frontmatter.ts` | Campos + obrigatoriedade + códigos de erro |
| Q5 | Techniques | Quais guardas de segurança de zip aplicar (traversal, symlink, ratio, depth, dup) e como detectá-las via metadados sem descompactar? | Web (yauzl externalFileAttributes) + PRD §5.4 + Google baseline | Lista de guardas + API mínima |
| Q6 | Techniques | Como modelar revisões imutáveis + content-hash + reserva de skillId pós-delete? | PRD §5.2 + Google baseline (reserva 24h) | Schema de `skill_revisions` + estratégia de reserva |

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
(tabela/lista/schema), com nomes/versões literais (sem fabricação).

## Acceptance Criteria

- [ ] 6 questions respondidas com citação a path real.
- [ ] Tabela de libs (zip/yaml/secret) com versão + licença + motivo.
- [ ] Campos do frontmatter Theokit + obrigatoriedade fixados.
- [ ] Guardas de zip enumeradas.
- [ ] Schema de revisões + estratégia de reserva de skillId definidos.
- [ ] 4 coverage corners populados; sem citação fabricada.

## Global Definition of Done

Blueprint ≥ `SHIPPABLE_WITH_CAVEATS` em `/discover-confidence`. Respeita
`rules/architecture.md` (DIP: `SecretScanner`/`PayloadValidator` como ports) e
`rules/testing.md`.
