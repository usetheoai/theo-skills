# PRD — Theo Skill Registry

> **Documento de Requisitos de Produto (Product Requirements Document)**
> Versão: 0.1.0 (Draft) · Status: `Em definição` · Data: 2026-06-22 · Owner: Plataforma Theo

---

## 1. Resumo executivo

O **Theo Skill Registry** é um serviço de registro, versionamento e descoberta de
**skills** para agentes de IA. Uma _skill_ é um pacote autocontido (instruções em
`SKILL.md`, scripts, referências e assets) que ensina um agente a executar uma
tarefa específica. O serviço permite **criar, atualizar, listar, recuperar e
deletar** skills, manter **histórico de revisões** e realizar **busca semântica**
("encontre skills para gerenciar recursos de nuvem") sobre o catálogo.

É uma reimplementação **inspirada** no [Skill Registry do Google Cloud Agent
Platform / Vertex AI](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/skill-registry/create-manage),
porém com contratos de API **próprios do Theo** (theo-native) — reusamos os
conceitos (skills, revisões, retrieve semântico, operações de longa duração), não
os paths/payloads literais do Google.

### 1.1 Problema

Agentes de IA precisam de capacidades reutilizáveis e versionadas. Hoje, no
ecossistema Theo, não existe um lugar canônico para:

- Publicar uma skill de forma versionada e auditável.
- Descobrir skills relevantes por linguagem natural (não só por nome exato).
- Anexar skills a agentes de forma consistente e governada.

Sem isso, o conhecimento das skills fica espalhado, duplicado e sem histórico —
violando o princípio de fonte única de verdade.

### 1.2 Proposta de valor

Um registro central, com API HTTP, que trata skills como artefatos de primeira
classe: imutáveis por revisão, descobríveis por busca semântica e gerenciáveis
por um ciclo de vida assíncrono (long-running operations).

---

## 2. Objetivos e não-objetivos

### 2.1 Objetivos (v1)

| # | Objetivo | Métrica de sucesso |
|---|---|---|
| O1 | CRUD completo de skills com payload zipado | Todas as operações `Create/Get/List/Update/Delete` funcionando E2E |
| O2 | Versionamento por revisão imutável | Toda atualização gera uma nova revisão; revisões antigas permanecem recuperáveis |
| O3 | Busca semântica (`RetrieveSkills`) | Recall@5 ≥ 0.8 em conjunto de avaliação interno |
| O4 | Operações de longa duração (LRO) | `Create/Update/Delete` retornam operação rastreável; cliente consegue fazer polling do status |
| O5 | Validação rígida de payload | Payloads inválidos são rejeitados na fronteira com erro claro e tipado |
| O6 | Observabilidade de nível produção | Logs estruturados, traces e métricas para 100% das requisições |

### 2.2 Não-objetivos (v1)

- **UI / Console web** — v1 é API-first. Frontend fica para fase posterior.
- **Compatibilidade drop-in com a API REST do Vertex** — adotamos contratos
  próprios (theo-native). Decisão registrada na seção [§4.1](#41-decisão-api-theo-native).
- **Multi-tenancy com isolamento físico** — v1 usa isolamento lógico por
  `projectId`/`location`; isolamento físico (CMEK, VPC-SC) não está no escopo.
- **Execução de skills** — o registro **armazena e descobre** skills; **executá-las**
  é responsabilidade do runtime do agente (ADK / Managed Agents), fora deste serviço.
- **Marketplace público / billing** — fora do escopo de v1.

---

## 3. Personas e casos de uso

| Persona | Necessidade | Caso de uso principal |
|---|---|---|
| **Skill Author** (engenheiro) | Publicar e versionar uma skill | `CreateSkill`, `UpdateSkill`, `ListSkillRevisions` |
| **Agent Builder** | Encontrar e anexar skills a um agente | `RetrieveSkills` (busca semântica), `GetSkill` |
| **Plataforma / Runtime do agente** | Buscar a revisão correta de uma skill em runtime | `GetSkill`, `GetSkillRevision` |
| **Operador / SRE** | Auditar e governar o catálogo | `ListSkills`, `GetOperation`, logs/traces |

### 3.1 Fluxo crítico (happy path)

```
Author empacota skill (SKILL.md + scripts/ + references/ + assets/)
  → POST /skills  (zip enviado)
  → serviço cria Operation (LRO)  → valida payload  → persiste revisão 1
  → gera embedding do (displayName + description + SKILL.md)
  → Operation = DONE
Agent Builder: GET /skills:retrieve?query="gerenciar recursos de nuvem"
  → busca vetorial  → retorna top-K skills ranqueadas
  → GET /skills/{id}  → recebe metadados + payload da última revisão
```

---

## 4. Decisões de arquitetura (ADRs resumidos)

### 4.1 Decisão: API theo-native

**Contexto:** o original expõe paths do Vertex
(`/v1beta1/projects/{p}/locations/{l}/skills`).
**Decisão:** adotamos paths e contratos próprios do Theo, reusando apenas os
**conceitos**. **Consequência:** não somos drop-in dos SDKs do Google, mas temos
liberdade para evoluir o contrato conforme as necessidades do Theo. Mantemos os
conceitos de `skillId` imutável, revisões e busca semântica.

### 4.2 Decisão: persistência alinhada à casa (Postgres + pgvector)

**Contexto:** precisamos guardar metadados relacionais, vetores de embeddings e os
payloads zipados das skills. Os demais serviços Theo (theo-memory, theo-rag,
theo-signals) padronizam **PostgreSQL + pgvector** como única dependência de
armazenamento — sem object storage nem Redis.
**Decisão:**

- **PostgreSQL** — fonte de verdade transacional para metadados de skills,
  revisões e operações (LRO).
- **pgvector** — índice vetorial para busca semântica (`RetrieveSkills`),
  co-localizado com os metadados (evita um vector DB separado — YAGNI).
- **Payload zipado** — armazenado no Postgres (coluna binária) na revisão, com
  `contentHash` para dedup e integridade. Mantém a stack idêntica à dos outros
  projetos Theo; nenhum serviço da casa usa object storage hoje.

**Consequência:** stack consistente com o restante do Theo, uma única dependência
de infraestrutura de dados, e busca vetorial co-localizada. Caso os payloads
cresçam a ponto de pressionar o banco, mover blobs para object storage é uma
evolução futura registrada — não antecipada em v1 (YAGNI).

### 4.3 Decisão: long-running operations via fila no Postgres (pg-boss)

**Contexto:** validação de payload, descompactação, geração de embeddings e
indexação podem levar segundos.
**Decisão:** `Create/Update/Delete` enfileiram um job via **pg-boss** (fila
persistida no próprio Postgres, mesmo padrão do worker de ingestão do theo-rag) e
retornam imediatamente uma `Operation`. Um worker processa de forma assíncrona e
atualiza o estado da operação.
**Consequência:** API responsiva; clientes fazem polling via `GetOperation`; sem
introduzir Redis na stack (KISS — reaproveita o Postgres já presente).

### 4.4 Decisão: provider de embeddings plugável

**Contexto:** o modelo de embeddings pode mudar (Vertex, OpenAI, modelo local).
**Decisão:** definir uma interface de domínio `EmbeddingProvider` (DIP). A
infraestrutura fornece a implementação concreta; o domínio depende só da abstração.
**Consequência:** trocar o modelo de embeddings não exige cirurgia no domínio;
testes unitários usam um provider fake.

---

## 5. Requisitos funcionais

### 5.1 Skill — modelo de domínio

| Campo | Tipo | Regras |
|---|---|---|
| `skillId` | string | **Imutável**. 1–63 chars; apenas minúsculas, números e hífens; começa com letra, termina com letra ou número; não começa com prefixo reservado (`gcp-`). Permanece reservado após deleção. |
| `displayName` | string | Nome usado pelo agente; participa da busca semântica. |
| `description` | string | Descrição do que a skill faz; participa da busca semântica. |
| `state` | enum | `CREATING`, `ACTIVE`, `UPDATING`, `DELETING`, `FAILED`. |
| `createTime` / `updateTime` | timestamp | Gerenciados pelo serviço. |
| `latestRevisionId` | string | Aponta para a revisão corrente. |

### 5.2 SkillRevision — modelo de domínio

| Campo | Tipo | Regras |
|---|---|---|
| `revisionId` | string | Imutável; identifica unicamente a revisão. |
| `skillId` | string | FK para a skill. |
| `payload` | bytes | Zip da revisão armazenado no Postgres (coluna binária). |
| `contentHash` | string | Hash do conteúdo (dedup + integridade). |
| `embedding` | vector | Vetor para busca semântica. |
| `createTime` | timestamp | Gerenciado pelo serviço. |

### 5.3 Endpoints (theo-native, ilustrativos)

> Contrato final será detalhado na fase de design. Paths abaixo são a intenção.

| Operação | Método | Path | Tipo |
|---|---|---|---|
| Create skill | `POST` | `/v1/skills` | LRO |
| Get skill (última revisão) | `GET` | `/v1/skills/{skillId}` | Síncrono |
| List skills | `GET` | `/v1/skills` | Síncrono (paginado) |
| Update skill | `PATCH` | `/v1/skills/{skillId}` | LRO |
| Delete skill | `DELETE` | `/v1/skills/{skillId}` | LRO |
| List revisions | `GET` | `/v1/skills/{skillId}/revisions` | Síncrono |
| Get revision | `GET` | `/v1/skills/{skillId}/revisions/{revisionId}` | Síncrono |
| Retrieve (semantic) | `GET` | `/v1/skills:retrieve?query=...&topK=...` | Síncrono |
| Get operation (LRO) | `GET` | `/v1/operations/{operationId}` | Síncrono |

#### 5.3.1 Create skill — payload

```jsonc
// POST /v1/skills
{
  "skillId": "cloud-resource-manager",   // imutável
  "displayName": "Cloud Resource Manager",
  "description": "Cria e gerencia recursos de nuvem do projeto.",
  "zippedFilesystem": "<base64 do zip>"   // SKILL.md + scripts/ + references/ + assets/
}
// → 200 { "operation": { "id": "...", "done": false } }
```

#### 5.3.2 Update skill — `updateMask`

Somente os campos listados em `updateMask` são atualizados
(`displayName`, `description`, `zippedFilesystem`). Atualizar o payload gera uma
**nova revisão**; metadados sem novo payload atualizam a skill sem nova revisão de
conteúdo.

#### 5.3.3 Retrieve — busca semântica

```jsonc
// GET /v1/skills:retrieve?query=gerenciar%20recursos%20de%20nuvem&topK=5
{
  "retrievedSkills": [
    { "skillId": "cloud-resource-manager", "displayName": "...", "description": "...", "score": 0.91 }
  ]
}
```

### 5.4 Validação de payload da skill

Na fronteira (fail-fast), o zip deve atender a:

- Conter um `SKILL.md` na raiz.
- Respeitar limites de tamanho (descompactado e compactado) — limites concretos
  definidos no design.
- Não conter paths perigosos (path traversal `../`, symlinks para fora do root).
- Estrutura de diretórios esperada: `SKILL.md` (obrigatório), `scripts/`,
  `references/`, `assets/` (opcionais).

Falha em qualquer regra → operação termina em `FAILED` com erro tipado e mensagem
clara (qual arquivo, qual regra violada).

---

## 6. Requisitos não-funcionais

| Categoria | Requisito |
|---|---|
| **Performance** | `Get`/`List`/`Retrieve` p95 < 300 ms (excluindo cold start). `Retrieve` sobre catálogo de 10k skills sem degradação perceptível. |
| **Escalabilidade** | Workers de LRO (pg-boss) escalam horizontalmente; busca vetorial indexada via pgvector. |
| **Confiabilidade** | LRO idempotente; retry com backoff em falhas transitórias; sem retry em violação de regra de negócio. |
| **Segurança** | Validação na fronteira; sem path traversal; autenticação/autorização por `projectId`; sem secrets em logs. |
| **Observabilidade** | Logs estruturados (JSON), traces distribuídos (OpenTelemetry), métricas RED por endpoint. |
| **Testabilidade** | Pirâmide de testes: unitários (domínio), integração (Postgres/storage reais via Testcontainers), E2E (fluxos críticos). |
| **Auditabilidade** | Toda mutação registrada; revisões imutáveis; `skillId` reservado pós-deleção. |

---

## 7. Arquitetura técnica

### 7.1 Stack

> Stack **idêntica à dos demais serviços Theo** (theo-memory, theo-rag,
> theo-signals): pnpm monorepo, TypeScript strict, Hono, Drizzle, Postgres +
> pgvector. Sem object storage e sem Redis.

| Camada | Escolha | Justificativa |
|---|---|---|
| Linguagem | **TypeScript** (strict) | Padrão da casa; `tsconfig` strict (ver §7.4). |
| Runtime | **Node.js ≥ 20** (ESM) | Engine padrão dos serviços Theo. |
| Monorepo | **pnpm workspaces** | `packages/core` + `packages/api`, como theo-memory/theo-rag. |
| HTTP | **Hono** + `@hono/node-server` + `@hono/zod-openapi` | Framework HTTP padrão da casa, com OpenAPI a partir de schemas Zod. |
| Validação | **Zod** | Schemas como fonte única de verdade de contrato (DRY). |
| Banco | **PostgreSQL + pgvector** | Transacional + busca vetorial co-localizada. |
| ORM/Query | **Drizzle ORM** + drizzle-kit | SQL explícito, type-safe (KISS); migrations versionadas. |
| Fila / LRO | **pg-boss** | Fila no próprio Postgres (mesmo padrão do worker do theo-rag); sem Redis. |
| Embeddings | **`EmbeddingProvider`** (port) → `openai` / `local` / `stub` | Plugável via DIP; mesmo trio de adapters da casa. |
| Telemetria | **OpenTelemetry** (`@opentelemetry/api`) | Traces + métricas padronizados. |
| Testes | **Vitest** (configs `contract` / `integration` / `e2e`) | Mesma convenção de testes dos outros projetos. |
| Lint | **ESLint flat** + `typescript-eslint` | `no-explicit-any`, `consistent-type-imports`, `import/order`. |

> Cada dependência significativa será registrada em um ADR curto ("escolhemos X
> porque Y"), conforme princípio "Não reinvente a roda".

### 7.2 Arquitetura em camadas (hexagonal / ports & adapters)

Monorepo pnpm, espelhando theo-memory/theo-rag:

```
packages/core  (@usetheo/skills)        ← biblioteca, sem HTTP
  src/contract/        ← tipos e interfaces (ports): Skill, SkillRevision, EmbeddingProvider
  src/domain/          ← regras de negócio: validação de skillId, ciclo de revisões, retrieve
  src/infrastructure/  ← adapters: db (Drizzle/Postgres), embedders/{openai,local,stub}, queue (pg-boss)
    db/schema.ts · db/migrations/

packages/api   (@usetheo/skills-api)    ← servidor Hono
  src/server/          ← app Hono, rotas OpenAPI /v1/*, handlers, middleware
```

- **`contract`/`domain`** definem interfaces (ports); **`infrastructure`** as
  implementa (adapters) — DIP.
- **Handlers** (api) só roteiam e validam entrada (SRP); a lógica vive no `core`.
- Troca de banco, fila ou modelo de embeddings não toca o domínio.

### 7.3 Modelo de dados (esboço)

```
skills(skill_id PK, display_name, description, state, latest_revision_id,
       create_time, update_time)
skill_revisions(revision_id PK, skill_id FK, payload bytea, content_hash,
                embedding vector, create_time)
operations(operation_id PK, skill_id, type, state, error, metadata,
           create_time, update_time)
```

- `payload` guarda o zip da revisão no Postgres (ver decisão §4.2).
- `embedding` é uma coluna `vector` (pgvector) com índice para `RetrieveSkills`.
- A fila pg-boss cria seu próprio schema no mesmo banco.

### 7.4 Convenções de TypeScript e tooling

- `tsconfig` strict da casa: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module: nodenext`,
  `target: es2022`, ESM (`"type": "module"`).
- Variável de conexão: `THEOSKILL_PG_URI` (segue o padrão `THEOMEM_PG_URI` /
  `THEORAG_PG_URI` / `THEOSIG_PG_URI`).
- `docker-compose` sobe apenas a imagem `pgvector` (Postgres com a extensão), igual
  aos demais serviços — sem Redis nem MinIO.

---

## 8. Tratamento de erros

Seguindo fail-fast / fail-loud / fail-clear:

| Situação | Comportamento |
|---|---|
| `skillId` inválido | `400` na fronteira, antes de qualquer I/O, com regra violada explícita. |
| Payload inválido (sem `SKILL.md`, tamanho, path traversal) | Operação → `FAILED` com erro de domínio tipado. |
| `skillId` já existe no Create | `409 Conflict`. |
| `skillId` reservado (deletado < 24h) | `409`/`423` com mensagem clara. |
| Skill inexistente em Get/Update/Delete | `404 Not Found`. |
| Falha transitória (storage/embeddings) | Retry com backoff dentro do worker; sem retry para violação de regra. |
| Tentar deletar skill built-in | `403 Forbidden`. |

Erros são exceções de domínio tipadas (ex.: `InvalidSkillIdError`,
`SkillNotFoundError`, `PayloadValidationError`), nunca strings genéricas. Logs de
erro carregam contexto suficiente para reprodução.

---

## 9. Plano de releases

| Marco | Entregas |
|---|---|
| **M0 — Fundação** | Monorepo pnpm (`core` + `api`), Hono + Zod, Postgres + Drizzle, CI, testes base. |
| **M1 — CRUD + revisões** | `Create/Get/List/Update/Delete` + revisões (payload no Postgres) + LRO via pg-boss + validação de payload. |
| **M2 — Busca semântica** | `EmbeddingProvider`, pgvector, `RetrieveSkills`, avaliação de recall. |
| **M3 — Hardening** | Observabilidade completa, rate limiting, testes E2E, ADRs consolidados. |

> Cada marco só avança com a task anterior 100% implementada (todos os fluxos
> funcionando de verdade, não mocks).

---

## 10. Métricas de sucesso do produto

- **Adoção:** nº de skills publicadas e nº de agentes consumindo via `RetrieveSkills`.
- **Qualidade da busca:** Recall@5 ≥ 0.8 no conjunto de avaliação.
- **Confiabilidade:** taxa de sucesso de LRO ≥ 99%; p95 de latência dentro do alvo.
- **Saúde de engenharia:** cobertura de testes da lógica de negócio = 100% dos
  casos de uso; zero erros silenciosos.

---

## 11. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Qualidade da busca semântica abaixo do alvo | Alto | Conjunto de avaliação desde M2; provider de embeddings plugável para troca de modelo. |
| Payloads maliciosos (zip bomb, path traversal) | Alto | Validação rígida na fronteira; limites de tamanho; sandbox de descompactação. |
| Crescimento de blobs no Postgres | Médio | Dedup por `contentHash`; limites de tamanho na fronteira; migração para object storage avaliada como evolução futura se necessário. |
| Acoplamento ao provider de embeddings | Médio | DIP via `EmbeddingProvider`. |
| LRO presa / inconsistente | Médio | Idempotência, timeouts, estados explícitos, observabilidade. |

---

## 12. Questões em aberto

- [ ] Modelo concreto de autenticação/autorização (IAM próprio? API keys? OIDC?).
- [ ] Limites exatos de tamanho de payload (compactado e descompactado).
- [ ] Política de retenção de revisões (manter todas? limitar histórico?).
- [ ] Modelo de embeddings default para M2.
- [ ] Estratégia de regiões/data residency (o original suporta US/EU).

---

## 13. Referências

- [Skill Registry — Google Cloud Agent Platform (create-manage)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/skill-registry/create-manage)
- [Google Cloud Skills repository (exemplos de SKILL.md)](https://github.com/google/skills/tree/main)
- [ADK Skill Registry integration](https://adk.dev/integrations/skills-registry/)
