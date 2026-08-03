---
slug: skill-registry
date: 2026-06-22
generated_by: roadmap-init
questions_answered: 7
unresolved_dims: []
status: completed
---

# Roadmap grill: skill-registry

> Foco declarado: **ser melhor que o Google Cloud Skill Registry**, com integração-alvo
> no **Theokit** (`../theokit-tools/theokit`, substituto do ADK da casa) — não no ADK do Google.
> Deep scraping do baseline Google capturado em `knowledge-base/references/_google-baseline.md`.

### Q1/7: Root problem

**Question:** Qual o problema-raiz que o projeto resolve e para quem dói hoje?

**Recommended:** (derivado do PRD §1.1) No ecossistema Theo não há registro canônico de skills versionadas e descobríveis; o conhecimento das skills fica espalhado, duplicado e sem histórico. O Theokit hoje só descobre skills do filesystem local, sem registro remoto nem busca semântica.

**User answer:** Confirmado via PRD. O problema-raiz: agentes Theokit precisam de skills versionadas, governadas e descobríveis por intenção — capacidade que nem o Theokit (só local) nem o Google Skill Registry (busca opaca, sem observabilidade/RBAC granular) entregam bem.

### Q2/7: Primary users

**Question:** Quem são os usuários primários?

**Recommended:** (PRD §3) Skill Author (engenheiro que publica/versiona), Agent Builder (encontra e anexa skills), Runtime do agente Theokit (busca a revisão certa em runtime), Operador/SRE (audita e governa).

**User answer:** Confirmado via PRD. Internos ao Theo; o consumidor de runtime é o **Theokit SkillsManager** (provider remoto a ser criado).

### Q3/7: In scope V1

**Question:** Além da paridade base (CRUD + revisões + busca semântica + LRO), quais diferenciais competitivos entram já no V1?

**Recommended:** Busca híbrida + score transparente (diferencial #1) e CLI de dev local (diferencial #2); webhook e RBAC como candidatos posteriores.

**User answer:** TODOS os quatro entram no V1:
- Busca híbrida (keyword + vetor/pgvector) com reranking e **score transparente**.
- **CLI de dev local** (lint/validate/test do payload SKILL.md antes do upload, incl. secret scan).
- **Webhook/eventos de LRO** (além de polling).
- **RBAC granular por skill** (não all-or-nothing por projeto, como no Google).
- (Implícito) Formato de skill **nativo do Theokit** (`SKILL.md` frontmatter: name/version/requires/description/allowed-tools/category/dependencies) — compatibilidade direta com o `discoverSkills`/`SkillsManager` do Theokit.

### Q4/7: Out of scope V1

**Question:** O que fica explicitamente fora do V1?

**Recommended:** Execução/runtime de skills, marketplace público, compliance pesado (CMEK/VPC-SC), composição/dependências entre skills.

**User answer:** Fora do V1:
- **Execução/runtime de skills** — isso é do Theokit (o foco; substituto do ADK), não do registry.
- **Marketplace público / skills da comunidade.**
- **Composição/dependências entre skills** (resolução transitiva + conflito).
- Nota: compliance pesado (CMEK/VPC-SC/HIPAA) não foi marcado in-scope V1 → tratado como **pós-V1** (diferencial forte mas caro).

### Q5/7: Hard constraints

**Question:** Quais as constraints duras (stack, compliance, prazo, time, runtime)?

**Recommended:** (PRD §7) Stack da casa: Node/TS strict, pnpm monorepo (`packages/core` + `packages/api`), Hono, PostgreSQL + pgvector, pg-boss (LRO), Drizzle, Vitest, ESLint flat, OpenTelemetry. Sem object storage nem Redis.

**User answer:** Confirmado. Constraint adicional crítica: **integração-alvo é o Theokit** (`../theokit-tools/theokit`) — o formato de skill e a API de descoberta devem casar com o `SkillsManager` do Theokit (TS strict, pnpm, frontmatter `SKILL.md`). NÃO seguir o ADK/contrato literal do Google.

### Q6/7: Success criterion V1 (shipped)

**Question:** Qual o número/comportamento que define o V1 entregue?

**Recommended:** Recall@5 ≥ 0.85 na busca + p95 < 200ms + dogfood real interno.

**User answer:** **Recall@5 ≥ 0.85** na busca de skills + **p95 < 200ms** no retrieve + **dogfood real** (Theokit interno consumindo o registry remoto em uso de verdade).

### Q7/7: North-star metric (winning)

**Question:** Qual métrica, ao se mover, prova que estamos ganhando?

**Recommended:** Time-to-relevant-skill (latência + precisão combinadas).

**User answer:** **Time-to-relevant-skill** — quão rápido e certo um agente Theokit encontra a skill correta para a intenção do usuário (combina latência de retrieve + precisão do ranqueamento).
