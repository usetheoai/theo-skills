---
slug: m1-skill-model-validation
version: 1.0.0
owner: plataforma-theo
created_at: 2026-06-22
generated_by: discover-execute
source_plan: knowledge-base/discoveries/plans/m1-skill-model-validation-plan.md
---

# Blueprint: M1 Skill Model + Rigorous Validation

Padrões e bibliotecas concretas para implementar o M1 sem reinventar (Unbreakable Rule 9) e
com 100% de compatibilidade com o que o Theokit parseia. Citações lidas, não inferidas.

## Context

ROADMAP M1 adiciona, sobre o walking skeleton M0: (1) parser de frontmatter `SKILL.md`
compatível com o Theokit; (2) validação rígida do payload zip (limites, traversal, symlink,
duplicados, `SKILL.md` na raiz, secret scan); (3) CRUD completo com revisões imutáveis +
reserva de skillId pós-delete. O openskills usa um regex YAML caseiro
(`knowledge-base/references/openskills/src/utils/yaml.ts`) — anti-padrão explícito a evitar.

## Objective

Fixar o formato de skill (união Theokit + AgentSkills), as bibliotecas a reusar, as guardas
de zip, a abordagem de secret-scan e o modelo de revisões/reserva, de forma que `/implement`
não tome nenhuma decisão de design nem reinvente roda.

## Coverage Corner 1 — Integration Tests

**Q1 — como validar SKILL.md (regras + shape do teste).**
Spec de referência (`knowledge-base/references/agentskills-spec/skills-ref/src/skills_ref/validator.py`):
limites `MAX_SKILL_NAME_LENGTH = 64`, `MAX_DESCRIPTION_LENGTH = 1024`, `MAX_COMPATIBILITY_LENGTH = 500`;
`ALLOWED_FIELDS = {name, description, license, allowed-tools, metadata, compatibility}`.
Regras de `name`: não-vazio, lowercase, sem `-` no início/fim, sem `--`, ≤64, deve coincidir com o diretório.
`description`: não-vazio, ≤1024.

Padrão de teste para o nosso validador (AAA, espelhando o estilo do M0):

```ts
describe('parseFrontmatter', () => {
  it('rejects missing description with a typed error', () => {
    expect(() => parseFrontmatter('---\nname: x\n---\n')).toThrow(SkillFrontmatterError);
  });
  it('rejects name > 64 chars / invalid charset / leading-trailing hyphen', () => { /* ... */ });
  it('accepts the Theokit union of fields and preserves unknown fields', () => { /* ... */ });
});
```

Integração (zip real, contra Postgres como no M0): construir um zip em memória (Buffer),
postar base64, e asserir 400 tipado para cada violação (traversal, symlink, ratio, sem SKILL.md,
secret presente) e 202→done para um zip válido com uma revisão persistida.

## Coverage Corner 2 — Dependencies

**Q2 — libs maduras (licença permissiva, manutenção atual):**

| Concern | Lib | Versão | Licença | Por quê |
|---|---|---|---|---|
| Zip-safety (in-memory, metadados sem descompactar) | `yauzl` | ^3.3.0 | MIT | Único que dá tamanho/uid-mode por entry da central directory sem descompactar (zip-bomb-safe); symlink via `externalFileAttributes >>> 16`. Usar `fromBuffer`. |
| Frontmatter split + YAML | `gray-matter` | ^4.0.3 | MIT | Incumbente battle-tested (Astro/VitePress/Docusaurus); split de delimitador robusto; engine default js-yaml **safe-load**. NUNCA habilitar o engine `javascript` (eval). |
| Secret scan (in-process) | `@secretlint/core` + `@secretlint/secretlint-rule-preset-recommend` | ^11.3.1 | MIT | Ruleset curado e mantido (AWS/GCP/chaves privadas/GitHub/Anthropic/Stripe…), escaneia strings em memória, sem binário/shell-out. |

Anti-padrões (NÃO fazer): copiar o regex YAML do openskills; usar `adm-zip` (descompacta tudo
em memória, histórico de Zip-Slip); criar regex próprio de secret (secretlint já cobre).

## Coverage Corner 3 — Tools

**Q3 — validar uma skill localmente.**
`knowledge-base/references/anthropic-skills/skills/skill-creator/scripts/quick_validate.py` valida
estrutura (SKILL.md presente, frontmatter mínimo `name`+`description`). Não há linter universal —
cada repo cuida do seu. → No M1 entregamos a validação no servidor (fronteira); a CLI de dev
local é M5 (reusará os mesmos checks do `core`, DRY). `secretlint` também tem CLI, mas usaremos
o core programático no caminho da request.

## Coverage Corner 4 — Techniques

**Q4 — frontmatter que o Theokit parseia.**
`theokit-sdk/packages/sdk/src/internal/runtime/skills/skill-frontmatter.ts`: extrai via
`/^---\s*\n([\s\S]*?)\n---\s*\n/`, parseia com um YAML simples, e **exige `description`**
(`ensureRequiredFields` → `ConfigurationError code=schema_invalid`); ausência de frontmatter →
`code=missing_frontmatter`. Interface `Skill` (discover-skills.ts:17): `{ name, description,
source, category?, dependencies? }`.

**União de campos a suportar** (obrigatórios: `name`, `description`; opcionais preservados):
`license`, `compatibility`, `metadata` (map), `allowed-tools`, `category`, `dependencies`,
`version`, `user-invocable`, `argument-hint`, `when_to_use`. Campos desconhecidos: **preservar**
(forward-compat), não rejeitar (diverge do strict do AgentSkills — decisão ADR D4).

**Q5 — guardas de zip** (de PRD §5.4 + Google baseline + yauzl):
- `SKILL.md` na raiz obrigatório.
- Itens ≤ 10.000 · descompactado total ≤ 500 MB · arquivo ≤ 10 MB · ratio ≤ 100:1 · profundidade ≤ 8.
- Rejeitar: nomes com `..`, caminho absoluto (`/`, `\`), symlink (unix mode `0o120000`), nomes duplicados.
- Detecção via metadados da central directory (`entry.uncompressedSize`, `compressedSize`,
  `externalFileAttributes`), **sem** `openReadStream` em entry que falhe uma guarda (nunca
  descompactar um zip-bomb). API: `yauzl.fromBuffer(buf, {lazyEntries:true})`.

**Q6 — revisões imutáveis + reserva de skillId.**
- `skill_revisions(revision_id PK, skill_id, payload bytea, content_hash, frontmatter jsonb,
  create_time)` — imutável (sem UPDATE). `skills.latest_revision_id` aponta para a corrente.
- `content_hash` = sha256 do zip (integridade + dedup).
- Reserva pós-delete: tombstone — `skills` ganha `deleted_at` + `reserved_until`; estado
  `DELETED`. Create rejeita (409) se houver reserva não-expirada. Janela **configurável** via
  env `THEOSKILL_ID_RESERVATION_HOURS` (default 24, não fixo). Get/List excluem `DELETED`.

## Cross-cutting Comparison

| Dimensão | openskills | agentskills-spec | Theokit | Decisão M1 |
|---|---|---|---|---|
| Parsing YAML | regex caseiro (anti-padrão) | strictyaml | line-parser simples | **gray-matter + js-yaml safe** (real, nested) |
| Campos desconhecidos | ignora | rejeita (strict) | ignora | **preservar** (forward-compat) — ADR D4 |
| Obrigatórios | name+desc | name+desc | description (name=dir) | **name + description** |
| Limites | nenhum | name≤64/desc≤1024 | nenhum | **aplicar limites AgentSkills** |
| Validação payload zip | n/a | zipfile/PyYAML | n/a | **yauzl + guardas (fail-fast 400)** |
| Secret scan | nenhum | nenhum | nenhum | **secretlint core (diferencial)** |

## ADRs

### D1 — Validação síncrona na fronteira (fail-fast), não no worker

Payload validado no handler `POST /v1/skills` (e no Update com payload) → `400` tipado em
qualquer violação, ANTES de enfileirar. O worker só persiste a revisão validada.
**Rationale:** PRD §5.4 + Unbreakable Rule 8 (fail-fast). **Rejeitado:** validar no worker
(operação `FAILED`) — atrasa o feedback e cria operações lixo para erro do cliente.

### D2 — Reusar libs maduras (yauzl/gray-matter/secretlint), não reinventar

**Rationale:** Unbreakable Rule 9; openskills regex YAML é o anti-padrão. **Rejeitado:**
parser caseiro / regex de secret próprio — frágil e inseguro. **Rejeitado:** `adm-zip`
(descompacta tudo; Zip-Slip histórico). **Rejeitado:** shell-out a gitleaks no caminho da
request (binário no container; gitleaks fica para o `/loop-security-audit` de repo inteiro).

### D3 — Revisões imutáveis com content-hash; payload em bytea no Postgres

`skill_revisions` nunca sofre UPDATE; Update de payload cria nova revisão e move
`latest_revision_id`. **Rationale:** PRD §4.2/§5.2; alinhado ao M0 (sem object storage).
**Rejeitado:** mutar a revisão — perde histórico/auditoria.

### D4 — Preservar campos desconhecidos do frontmatter (forward-compat)

Diferente do strict do AgentSkills, guardamos o frontmatter completo (jsonb) e só validamos
os campos conhecidos + limites. **Rationale:** o Theokit evolui o frontmatter (hooks, paths,
effort…); rejeitar campos novos quebraria skills válidas do Theokit. **Rejeitado:** strict
allow-list — frágil contra a evolução do formato Theokit.

### D5 — Reserva de skillId configurável (não 24h fixos)

Janela via `THEOSKILL_ID_RESERVATION_HOURS` (default 24). **Rationale:** ROADMAP M1 pede
"janela configurável, não 24h fixos"; supera a rigidez do Google. **Rejeitado:** hard-code 24h.

## Recommendations for the project

1. `core` define os ports `PayloadValidator` e `SecretScanner` (DIP); `infrastructure` provê os
   adapters yauzl/secretlint. Handlers/worker dependem das abstrações.
2. Validação de zip e frontmatter compartilhada entre servidor (M1) e CLI (M5) — código no
   `core` (DRY), nunca duplicar.
3. `content_hash` = sha256 (stdlib `node:crypto`) — não adicionar dep.
4. Limites como constantes nomeadas (centralizadas) — não literais espalhados.
5. Testar cada guarda de zip com um zip-fixture construído em memória (traversal, symlink via
   external attrs, ratio alto, sem SKILL.md, dup, secret embutido).
6. `gray-matter`: NUNCA habilitar engine `javascript`. `yauzl`: nunca `openReadStream` entry
   que falhe guarda. `secretlint`: escanear conteúdo em memória, sem escrever em disco.

## Acceptance Criteria — status

- [x] 6 questions respondidas com citação a path real.
- [x] Tabela de libs (zip/yaml/secret) com versão + licença + motivo.
- [x] Campos do frontmatter Theokit + obrigatoriedade fixados (name+description).
- [x] Guardas de zip enumeradas (limites + traversal + symlink + dup).
- [x] Schema de revisões + estratégia de reserva de skillId definidos.
- [x] 4 coverage corners populados; sem citação fabricada.

## Related

- Plano: `knowledge-base/discoveries/plans/m1-skill-model-validation-plan.md`
- Peers: `knowledge-base/references/{openskills,agentskills-spec,anthropic-skills}`
- Consumidor-alvo: `theokit-sdk` (`/home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk`)
- M0: `knowledge-base/discoveries/blueprints/m0-walking-skeleton-blueprint.md`; PRD §4-5; ROADMAP M1.
