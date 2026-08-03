# Google Cloud Skill Registry — Baseline (o que vamos superar)

> Deep scraping de 2026-06-22 das páginas oficiais. Este é o BASELINE competitivo do
> `skill-registry` (ver `ROADMAP.md` e `knowledge-base/grills/skill-registry-roadmap-grill.md`).
> Fontes:
> - https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/skill-registry?hl=pt-br
> - https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/skill-registry/create-manage?hl=pt-br

## O que é

Registro "seguro, privado, de baixa latência" de **skills** para agentes (Gemini
Enterprise Agent Platform / Vertex AI). Skill = pacote (instruções + código + docs) em ZIP.
Status **Pre-GA** ("as is", suporte limitado).

## Estrutura da skill

- `SKILL.md` obrigatório (YAML front-matter + Markdown).
- Front-matter: `name` (≤64ch, lowercase/dígito/hífen, não começa/termina com hífen),
  `description` (≤1024ch, obrigatório), `license` (≤1024ch), instruções (≤500.000ch).
- Diretórios de apoio: `scripts/`, `references/`, `assets/`.

## Validação de payload (limites exatos)

| Regra | Limite |
|---|---|
| Itens no ZIP | ≤ 10.000 |
| Tamanho descompactado | ≤ 500 MB |
| Tamanho por arquivo compactado | ≤ 10 MB |
| Razão de compressão | ≤ 100:1 |
| Profundidade de pastas | ≤ 8 níveis |

Proibido: `..` em nomes, `/`/`\` iniciais, symlinks, nomes duplicados, `SKILL.md`
ausente, front-matter ausente, ZIP vazio. **Sem** scan de vírus/segredos/código.

## API (métodos)

| Método | Verbo | Path | Tipo |
|---|---|---|---|
| CreateSkill | POST | `.../skills?skillId=ID` | LRO |
| UpdateSkill | PATCH | `.../skills/ID?updateMask=...` | LRO |
| ListSkills | GET | `.../skills` | sync |
| GetSkill | GET | `.../skills/ID` | sync (última revisão) |
| DeleteSkill | DELETE | `.../skills/ID` | LRO |
| ListSkillRevisions | GET | `.../skills/ID/revisions` | sync |
| GetSkillRevision | GET | `.../skills/ID/revisions/REV` | sync |
| RetrieveSkills | GET | `.../skills:retrieve?query=Q&topK=K` | sync (semantic) |
| GetOperation | GET | `.../operations/OP` | sync (polling) |

- `skillId`: 1–63ch, lowercase/dígito/hífen, começa com letra, termina com letra/dígito,
  **imutável**, **reservado 24h após delete**, prefixo `gcp-` reservado.
- LRO: só **polling** via GetOperation (sem webhook/push).
- `updateMask`: atualização seletiva (`displayName,description,zippedFilesystem`).
- IAM: herdado do projeto (all-or-nothing; sem granularidade por skill).

## Regiões e compliance

- Regiões: `us-central1`, `europe-west4`, `us-east5`.
- Access Transparency: ✅ · Data Residency US/EU: ✅ · CMEK: ❌ · HIPAA: ❌ · VPC-SC: ❌.

## Built-in skills

- `gcp-skill-registry` (Google gerencia ciclo de vida/versões). Não deletável.

## Fraquezas exploráveis (= nosso diferencial — mapeadas em milestones)

| Fraqueza do Google | Nossa resposta | Milestone |
|---|---|---|
| LRO só por polling | Webhook/eventos de conclusão | M2 |
| IAM all-or-nothing por projeto | RBAC granular por skill | M6 |
| Busca semântica opaca (sem score/modelo) | Híbrida (keyword+vetor) + rerank + score | M4 |
| Sem observabilidade por skill | Traces/métricas/error budget (OTel) | M8 |
| Sem CLI de dev local | CLI lint/validate/test + secret scan | M5 |
| Sem CMEK/VPC-SC/HIPAA | Compliance-first (pós-V1) | out-of-scope V1 |
| Sem composição/dependências | Skills dependentes (pós-V1) | out-of-scope V1 |
| Sem rollback 1-clique | Versionamento + rollback | M1/M2 |
| Lock de 24h no ID | Lock configurável | M1 |
| Validação sem scan de segredo/vírus | Secret scan no upload | M1/M5 |
| Formato preso ao Vertex/ADK | Formato nativo do **Theokit** (`SKILL.md`) + provider remoto | M1/M7 |
