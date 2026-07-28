# Theo Skill Registry

> Registro, versionamento e descoberta semântica de **skills** para agentes de IA.

[![Status](https://img.shields.io/badge/status-draft-orange)](./PRD.md)
[![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20TypeScript-blue)](#stack)

O **Theo Skill Registry** é um serviço API-first que trata _skills_ de agentes
como artefatos de primeira classe: **imutáveis por revisão**, **descobríveis por
busca semântica** e gerenciados por um ciclo de vida assíncrono
(long-running operations).

Uma _skill_ é um pacote autocontido — `SKILL.md` + `scripts/` + `references/` +
`assets/` — que ensina um agente a executar uma tarefa.

> ℹ️ Projeto **inspirado** no [Skill Registry do Google Cloud Agent
> Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/skill-registry/create-manage),
> com contratos de API **próprios do Theo** (theo-native). Reusamos os conceitos,
> não os paths/payloads literais do Google.

---

## Índice

- [O que ele faz](#o-que-ele-faz)
- [Stack](#stack)
- [Arquitetura](#arquitetura)
- [Começando](#começando)
- [API](#api)
- [Estrutura de uma skill](#estrutura-de-uma-skill)
- [Desenvolvimento](#desenvolvimento)
- [Testes](#testes)
- [Roadmap](#roadmap)
- [Documentação](#documentação)

---

## O que ele faz

| Capacidade | Descrição |
|---|---|
| **CRUD de skills** | Criar, obter, listar, atualizar e deletar skills com payload zipado. |
| **Revisões imutáveis** | Cada atualização de payload gera uma nova revisão; o histórico permanece recuperável. |
| **Busca semântica** | `RetrieveSkills` — encontre skills por linguagem natural ("gerenciar recursos de nuvem"). |
| **Long-running operations** | `Create/Update/Delete` retornam uma operação rastreável por polling. |
| **Validação rígida de payload** | Rejeição na fronteira (fail-fast) de payloads inválidos ou perigosos. |

> Escopo detalhado, decisões de arquitetura e requisitos estão no **[PRD.md](./PRD.md)**.

---

## Stack

> Mesma stack dos demais serviços Theo (theo-memory, theo-rag, theo-signals).

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (strict, ESM) |
| Runtime | Node.js ≥ 20 |
| Monorepo | pnpm workspaces (`packages/core` + `packages/api`) |
| HTTP | Hono + `@hono/node-server` + `@hono/zod-openapi` |
| Validação | Zod |
| Banco | PostgreSQL + **pgvector** |
| ORM | Drizzle ORM + drizzle-kit |
| Fila / LRO | pg-boss (fila no próprio Postgres) |
| Embeddings | Provider plugável (`EmbeddingProvider`): `openai` / `local` / `stub` |
| Observabilidade | OpenTelemetry |
| Testes | Vitest (`contract` / `integration` / `e2e`) |
| Lint | ESLint flat + typescript-eslint |

---

## Arquitetura

Monorepo pnpm com arquitetura hexagonal (ports & adapters) — o domínio depende de
abstrações, a infraestrutura as implementa (DIP):

```
packages/core  (@usetheo/skills)        → biblioteca, sem HTTP
  contract/        → tipos e ports: Skill, SkillRevision, EmbeddingProvider
  domain/          → regras: validação de skillId, revisões, retrieve
  infrastructure/  → adapters: Drizzle/Postgres · embedders/{openai,local,stub} · pg-boss

packages/api   (@usetheo/skills-api)    → servidor Hono
  server/          → app Hono, rotas OpenAPI /v1/*, handlers, middleware
```

Persistência: **Postgres** para metadados/revisões/operações e payloads zipados,
**pgvector** para o índice de busca semântica, **pg-boss** para a fila de LRO — sem
object storage e sem Redis, igual aos demais serviços Theo.
Detalhes em [PRD §4.2 e §7](./PRD.md).

---

## Começando

> ⚠️ **Pré-release.** A implementação está em fase de fundação (marco M0). Os
> comandos abaixo refletem o fluxo-alvo de desenvolvimento e serão validados
> conforme o código for entregue.

### Pré-requisitos

- Node.js ≥ 20
- pnpm
- Docker (para o Postgres + pgvector local via `docker compose`)

### Setup local

```bash
# 1. Instalar dependências (monorepo)
pnpm install

# 2. Subir infraestrutura local (Postgres com pgvector)
docker compose up -d

# 3. Variáveis de ambiente (inclui THEOSKILL_PG_URI)
cp .env.example .env

# 4. Migrations
pnpm db:push        # ou pnpm db:generate para gerar SQL versionado

# 5. Rodar a API (e o worker de LRO)
pnpm dev
```

---

## API

> Contratos theo-native. Paths abaixo são a intenção de design (ver [PRD §5.3](./PRD.md));
> o contrato final é validado na implementação.

| Operação | Método | Path | Tipo |
|---|---|---|---|
| Create skill | `POST` | `/v1/skills` | LRO |
| Get skill | `GET` | `/v1/skills/{skillId}` | Síncrono |
| List skills | `GET` | `/v1/skills` | Síncrono |
| Update skill | `PATCH` | `/v1/skills/{skillId}` | LRO |
| Delete skill | `DELETE` | `/v1/skills/{skillId}` | LRO |
| List revisions | `GET` | `/v1/skills/{skillId}/revisions` | Síncrono |
| Get revision | `GET` | `/v1/skills/{skillId}/revisions/{revisionId}` | Síncrono |
| Retrieve (semantic) | `GET` | `/v1/skills:retrieve?query=...&topK=...` | Síncrono |
| Get operation | `GET` | `/v1/operations/{operationId}` | Síncrono |

### Exemplo — criar uma skill

```bash
# Empacotar a skill em base64
ZIP=$(zip -r - SKILL.md scripts/ references/ assets/ | base64 -w 0)

curl -X POST http://localhost:8080/v1/skills \
  -H "Content-Type: application/json" \
  -d "{
    \"skillId\": \"cloud-resource-manager\",
    \"displayName\": \"Cloud Resource Manager\",
    \"description\": \"Cria e gerencia recursos de nuvem do projeto.\",
    \"zippedFilesystem\": \"$ZIP\"
  }"
# → { "operation": { "id": "op_...", "done": false } }
```

### Exemplo — busca semântica

```bash
curl "http://localhost:8080/v1/skills:retrieve?query=gerenciar%20recursos%20de%20nuvem&topK=5"
# → { "retrievedSkills": [ { "skillId": "cloud-resource-manager", "score": 0.91, ... } ] }
```

### `skillId` — regras

- 1 a 63 caracteres; apenas minúsculas, números e hífens.
- Começa com letra; termina com letra ou número.
- **Imutável** e reservado mesmo após deleção.
- Não pode começar com prefixo reservado (`gcp-`).

---

## Estrutura de uma skill

```
minha-skill/
├── SKILL.md          # obrigatório — instruções que o agente lê
├── scripts/          # opcional — código executável da skill
├── references/       # opcional — documentação de apoio
└── assets/           # opcional — arquivos estáticos
```

Exemplos de `SKILL.md` reais:
[Google Cloud Skills repository](https://github.com/google/skills/tree/main).

---

## Desenvolvimento

Este projeto segue os **Princípios Inquebráveis** de engenharia da casa
(KISS, YAGNI, DRY, SOLID, fail-fast, testes obrigatórios).

### Git

- Toda mudança vai para a branch **`develop`** (sem feature branches).
- **`main`** é protegida — recebe apenas merges de release.
- Toda mudança visível ao consumidor entra no **[CHANGELOG.md](./CHANGELOG.md)**.

### Scripts (alvo)

```bash
pnpm dev             # API + worker em modo watch
pnpm build           # build de produção (tsc, ESM)
pnpm lint            # ESLint (typescript-eslint)
pnpm test            # testes (vitest contract)
pnpm test:int        # testes de integração (vitest integration)
pnpm db:push         # aplica o schema no banco
pnpm db:generate     # gera migrations SQL versionadas
```

---

## Testes

Pirâmide de testes (mesma convenção da casa — `vitest.{contract,integration,e2e}.config.ts`):

- **Contract (unit)** — lógica de domínio isolada (validação de `skillId`, regras
  de revisão), rápidos e determinísticos.
- **Integração** — repositórios e fila contra Postgres real.
- **E2E** — fluxos críticos: criar → recuperar por busca → obter revisão.

> Código sem teste é código que funciona por coincidência. Toda lógica de negócio
> tem teste; todo bug corrigido gera um teste de regressão antes do fix.

---

## Roadmap

| Marco | Entregas |
|---|---|
| **M0 — Fundação** | Monorepo pnpm (`core` + `api`), Hono + Zod, Postgres + Drizzle, CI. |
| **M1 — CRUD + revisões** | CRUD completo + revisões (payload no Postgres) + LRO via pg-boss + validação. |
| **M2 — Busca semântica** | `EmbeddingProvider`, pgvector, `RetrieveSkills`. |
| **M3 — Hardening** | Observabilidade, rate limiting, E2E, ADRs. |

Detalhes no [PRD §9](./PRD.md).

---

## Documentação

- **[PRD.md](./PRD.md)** — requisitos, decisões de arquitetura e plano de releases.
- **[CHANGELOG.md](./CHANGELOG.md)** — histórico de mudanças.

### Referências externas

- [Skill Registry — Google Cloud Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/skill-registry/create-manage)
- [ADK Skill Registry integration](https://adk.dev/integrations/skills-registry/)
