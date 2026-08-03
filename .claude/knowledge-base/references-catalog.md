---
generated_by: roadmap-init
generated_on: 2026-06-22
slug: skill-registry
peer_count_cloned: 9
peer_count_skipped: 0
note: >
  This catalog lives at knowledge-base/references-catalog.md (sibling of references/)
  instead of knowledge-base/references/_catalog.md because this project enforces
  references/ as read-only (boundary-check.sh + permission policy block all writes
  there). The roadmap-init contract location was overridden by the stronger project rule.
---

# References catalog

State-of-the-art peer projects gathered at project inception by `/roadmap-init`.
This file is the contract `/discover-plan` reads when investigating a peer.

> **Lifecycle:** every peer below has lifecycle `cloned` (folder present under
> `knowledge-base/references/`). No peer was rejected at the license gate.
> Two peers (`anthropic-skills`, `openskills`) were cloned **study-only** — their
> license is not a clear permissive SPDX; do NOT copy code into the codebase.

---

## anthropic-skills

- **Folder:** `knowledge-base/references/anthropic-skills/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/anthropics/skills
- **License:** `no SPDX at repo root` (example skills Apache-2.0; document skills source-available)
- **License-gate decision:** clone-anyway-study-only
- **Last release / last commit:** 2026-06-09
- **Stars / forks at clone time:** 153867 / 18145

### Why this peer is here

Origem canônica do formato `SKILL.md` que o Theokit adota. Define frontmatter, estrutura de
pastas e o `skill-creator` (otimização de `description` para trigger de invocação) — exatamente
o formato que o nosso registry precisa armazenar, validar e devolver ao Theokit.

### What to study in it

- Frontmatter e estrutura `SKILL.md` (campos mínimos, convenções scripts/references/assets).
- `skill-creator`: como a `description` determina invocação (insumo para o ranking do retrieve).
- Critérios implícitos de validação de uma skill bem-formada.

### Supports ROADMAP milestone(s)

- M1 — *because:* modelo de skill + validação devem casar com o formato canônico.
- M5 — *because:* a CLI de validação local valida contra estas regras de formato.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/anthropics/skills.git knowledge-base/references/anthropic-skills/
```

---

## agentskills-spec

- **Folder:** `knowledge-base/references/agentskills-spec/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/agentskills/agentskills
- **License:** `Apache-2.0` (docs CC-BY-4.0)
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-05-20
- **Stars / forks at clone time:** 20914 / 1320

### Why this peer is here

Especificação ABERTA e formal do formato `SKILL.md`. Onde o repo da Anthropic mostra exemplos,
este define as regras de conformance — base para a nossa validação rígida ser correta e portável.

### What to study in it

- Spec formal do frontmatter e do corpo (campos obrigatórios vs opcionais).
- Regras de conformance / validação que um registry deve impor.
- Pontos de extensão do formato (compatibilidade futura).

### Supports ROADMAP milestone(s)

- M1 — *because:* a validação de payload e do frontmatter deve seguir a spec.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/agentskills/agentskills.git knowledge-base/references/agentskills-spec/
```

---

## openskills

- **Folder:** `knowledge-base/references/openskills/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/numman-ali/openskills
- **License:** `non-standard (NOASSERTION)`
- **License-gate decision:** clone-anyway-study-only
- **Last release / last commit:** 2026-01-18
- **Stars / forks at clone time:** 10474 / 662

### Why this peer is here

Loader universal de `SKILL.md` em TypeScript (mesma linguagem do nosso registry e do Theokit).
Mostra como parsear frontmatter e instalar/resolver skills cross-agent — diretamente relevante
ao parser de M1 e ao provider remoto do Theokit em M7.

### What to study in it

- Parsing de frontmatter `SKILL.md` em TS (validação, skip de malformadas).
- Modelo de instalação/resolução de skills e fallback.
- Pontos de extensão para um provider remoto (HTTP) por cima de um loader local.

### Supports ROADMAP milestone(s)

- M1 — *because:* parser de `SKILL.md` em TS compatível com o Theokit.
- M7 — *because:* o `RemoteSkillsManager` do Theokit espelha um loader como este (HTTP + cache + fallback).

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/numman-ali/openskills.git knowledge-base/references/openskills/
```

---

## semantic-router

- **Folder:** `knowledge-base/references/semantic-router/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/aurelio-labs/semantic-router
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-05-23
- **Stars / forks at clone time:** 3629 / 339

### Why this peer is here

Implementação madura de roteamento/retrieval por intenção via embeddings — o núcleo do nosso
`RetrieveSkills`. Ensina como ranquear por similaridade semântica com baixa latência.

### What to study in it

- Route layer: encode de utterances, comparação por similaridade, escolha de rota.
- Estratégias híbridas (denso + esparso) e calibração de score.
- Técnicas de baixa latência (alvo p95 < 200ms).

### Supports ROADMAP milestone(s)

- M4 — *because:* busca híbrida transparente com score é o coração deste peer.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/aurelio-labs/semantic-router.git knowledge-base/references/semantic-router/
```

---

## composio

- **Folder:** `knowledge-base/references/composio/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/ComposioHQ/composio
- **License:** `MIT`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-06-22
- **Stars / forks at clone time:** 28896 / 4633

### Why this peer is here

Plataforma de tool search em escala (1000+ toolkits) com auth e context management em TS.
Referência de descoberta de capacidades em catálogo grande e de modelagem de autenticação.

### What to study in it

- Tool search / ranking em catálogo grande (escala da descoberta).
- Modelo de autenticação e gestão de contexto por usuário.
- Padrões de SDK (TS) para consumo por agentes.

### Supports ROADMAP milestone(s)

- M4 — *because:* tool search em escala informa o ranking do retrieve.
- M6 — *because:* o modelo de auth informa o RBAC granular por skill.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/ComposioHQ/composio.git knowledge-base/references/composio/
```

---

## mcp-context-forge

- **Folder:** `knowledge-base/references/mcp-context-forge/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/IBM/mcp-context-forge
- **License:** `Apache-2.0`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-06-22
- **Stars / forks at clone time:** 3940 / 716

### Why this peer is here

Registry + proxy com discovery centralizado, governança, observabilidade e plugins. Referência
de como um registry de capacidades faz governança e observabilidade de nível produção.

### What to study in it

- Discovery centralizado e federação de fontes.
- Governança (políticas, guardrails) e observabilidade integrada.
- Arquitetura de plugins / pontos de extensão.

### Supports ROADMAP milestone(s)

- M2 — *because:* governança e rastreabilidade das operações (LRO).
- M8 — *because:* observabilidade de nível produção por skill/operação.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/IBM/mcp-context-forge.git knowledge-base/references/mcp-context-forge/
```

---

## mcp-gateway-registry

- **Folder:** `knowledge-base/references/mcp-gateway-registry/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/agentic-community/mcp-gateway-registry
- **License:** `Apache-2.0`
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-06-22
- **Stars / forks at clone time:** 724 / 195

### Why this peer is here

Registry de assets (MCP servers, agents, skills) com OAuth/Keycloak, discovery dinâmico e
acesso auditável. Referência direta de RBAC granular e auditoria — o diferencial sobre o
IAM all-or-nothing do Google.

### What to study in it

- RBAC granular por asset + integração OAuth/Keycloak.
- Audit log de acesso e governança de múltiplos tipos de asset.
- Discovery dinâmico com controle de acesso.

### Supports ROADMAP milestone(s)

- M6 — *because:* RBAC granular por skill + auditoria espelham este peer.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/agentic-community/mcp-gateway-registry.git knowledge-base/references/mcp-gateway-registry/
```

---

## Skipped peers (license gate)

| Peer | Repo | License | Reason for skip |
|---|---|---|---|
| (none) | — | — | Nenhum peer rejeitado; os 2 sem licença permissiva foram clonados study-only com acknowledgement explícito. |

> Note: `pgvector/pgvector` foi deliberadamente NÃO clonado — já é dependência direta da
> stack (Postgres + pgvector), não material de estudo (YAGNI).

---

## agentic-context-engine

- **Folder:** `knowledge-base/references/agentic-context-engine/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/kayba-ai/agentic-context-engine
- **License:** Apache-2.0
- **License-gate decision:** clone-anyway-study-only
- **Last commit:** 2026-06 (shallow clone)
- **Added by:** `/discover-plan theokit-registry-contract` (2026-06-23)

### Why this peer is here

ACE (Stanford/SambaNova paper + Dynamic Cheatsheet) is the primary prior art for the
Agent/Reflector/SkillManager learning loop + persistent Skillbook. It is the citable source for
the `theokit-registry-contract` blueprint: how a learned-strategy store models curation
(`UpdateBatch` ADD/UPDATE/TAG/REMOVE, soft-delete via `active`) and where the registry/runtime
boundary falls (`ask`/`learn.*` fenced behind `safe_mode`).

### What to study in it

- `ace/core/skillbook.py` — `Skill` dataclass, `UpdateOperation`/`UpdateBatch`, `apply_update` (atomic batch).
- `ace/integrations/mcp/{handlers,models,adapters}.py` — the 6 MCP verbs split store vs runtime.
- `tests/test_ace_core.py` + `tests/test_ace_mcp_handlers.py` — curation invariants to mirror.

### Supports ROADMAP milestone(s)

- M7 — *because:* the registry↔Theokit contract (RemoteSkillsManager) is derived from ACE's loop.
- M9 — *because:* observability/feedback gaps reference ACE patterns.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/kayba-ai/agentic-context-engine knowledge-base/references/agentic-context-engine/
```

---

## cat-agent-skills

- **Folder:** `knowledge-base/references/cat-agent-skills/`
- **Lifecycle:** cloned
- **Repo:** https://github.com/microsoft/cat-agent-skills
- **License:** `MIT` (Microsoft Corporation; `CONTRIBUTING.md` exige que toda submissão seja compartilhada sob a MIT do repo — as 74 skills de terceiros em `submissions/` estão cobertas)
- **License-gate decision:** auto-approved-permissive
- **Last release / last commit:** 2026-07-29 (`71f89f4`)
- **Stars / forks at clone time:** 41 / 51
- **Added by:** referência indicada pelo owner (2026-07-30)

### Why this peer is here

Galeria pública de Agent Skills da Microsoft (Copilot Studio / Cowork / Scout) — o único peer do
catálogo que é ao mesmo tempo um **registry em operação real** e um **corpus de 74 skills reais**.
Os outros peers do formato (`anthropic-skills`, `agentskills-spec`, `openskills`) definem ou parseiam
o `SKILL.md`; este mostra o que um registry precisa decidir **em volta** dele: separação de metadados,
validação em CI, curadoria de submissões e um sinal de qualidade por skill.

Três achados sem paralelo no resto do catálogo:

1. **Duas descrições, deliberadamente separadas** (`docs/authoring-skills.md` § 2): a `description` do
   frontmatter do `SKILL.md` é **agent-facing** (um gatilho preciso, lido pelo modelo para decidir
   quando invocar); a `description` do `metadata.json` é **catalog-facing** (uma linha amigável para
   humanos na galeria). No schema elas coexistem como `agentDescription` e `description`
   (`src/lib/skill-schema.ts`). Nosso `SkillInput` tem um único par `displayName`/`description`, e o
   DoD de M3 indexa "displayName + description + corpo SKILL.md" no mesmo vetor — vale verificar se
   estamos misturando texto de gatilho com texto de vitrine no embedding.
2. **Ratings como sinal de qualidade por skill** (`docs/ratings.md` + `scripts/fetch-ratings.ts`):
   reações positivas em GitHub Discussions (uma discussion por slug) somadas via GraphQL em CI e
   assadas num snapshot `ratings.json` de build. Degradação graciosa: sem token/discussions o arquivo
   fica `{}` e tudo mostra `0`. É um sinal de popularidade fora do texto — insumo para o rerank do M4,
   que hoje é keyword + vetor puros.
3. **Um schema Zod único como fonte da verdade**, importado tanto pela content collection do Astro
   (build-time) quanto pelo validador standalone de CI (`scripts/validate-skill.ts`), com o comentário
   explícito de que existe "so the rules can never drift". É exatamente a nossa aposta de M1/M5
   (checker único no `core`, consumido por CLI e fronteira HTTP) — prior art independente para ela,
   na mesma linguagem.

### What to study in it

- `src/lib/skill-schema.ts` — schema Zod compartilhado; note `agentDescription` vs `description`, o
  discriminador `type: skill | plugin | automation` (derivado pelo importer, não autorado) e mensagens
  de erro escritas para o autor ("author is required — add it to the submission's metadata.json").
- `scripts/validate-skill.ts` (116 LoC) — validador com saída itemizada por campo e exit codes
  scriptáveis; o mesmo shape de DX que a nossa CLI de M5 persegue.
- `scripts/import-submissions.ts` (1054 LoC, com `.test.ts`) — pipeline de ingestão/curadoria:
  empacota o bundle, resolve autoria a partir da submissão (nunca do login do PR/merger) e normaliza
  os metadados. Referência de curadoria para M2.
- `docs/ratings.md` + `scripts/fetch-ratings.ts` — o sinal de rating fim-a-fim (M4).
- `docs/authoring-skills.md` + `submissions/_template/` — o contrato de autoria: `SKILL.md` +
  `metadata.json` + `scripts/` opcional, com o `bundle` derivado automaticamente.
- `submissions/` (74 skills reais: `SKILL.md` + metadata + `scripts/`/`references/`) — corpus de
  skills genuínas, em contraste com fixtures sintéticas.

### Supports ROADMAP milestone(s)

- M1 — *because:* a separação metadados-de-catálogo vs frontmatter-de-agente e o schema único
  informam o modelo de skill e a validação de fronteira.
- M4 — *because:* rating por skill é um sinal de rerank fora do texto, e o corpus de 74 skills é
  material candidato para o eval set de Recall@5.
- M5 — *because:* `validate-skill.ts` é o precedente direto do `theoskill validate` (mesma
  linguagem, mesma regra compartilhada com o servidor).
- M7 — *because:* consome o formato canônico Agent Skills que o provider remoto do Theokit devolve.

### Open question this peer raises (not a decision)

Usar as 74 submissões como **eval set** de M4 é atraente (skills reais, descrições escritas para
gatilho) e a MIT permite com atribuição — mas copiar bytes da zona para `packages/api/eval/` é
material derivado e a zona é read-only por regra nossa (`reference-provenance.md`). Se essa rota
for desejada, ela precisa de decisão explícita (ADR + atribuição no `CHANGELOG`), não de um `cp`.

### Clone command used

```bash
git clone --depth 1 --filter=blob:none https://github.com/microsoft/cat-agent-skills.git knowledge-base/references/cat-agent-skills/
```

---

## Cleanup protocol

- **Remove a peer:** delete its folder under `knowledge-base/references/` AND remove its entry from this catalog in the same commit.
- **Update a peer (refresh clone):** `cd knowledge-base/references/{peer}/ && git pull` — record the new commit SHA here.
- **Replace a peer with a better one:** treat as remove + add. Do NOT rename folders.
