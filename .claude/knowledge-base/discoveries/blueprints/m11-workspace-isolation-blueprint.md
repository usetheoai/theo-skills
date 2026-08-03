---
slug: m11-workspace-isolation
milestone_id: M11
date: 2026-07-30
generated_by: discover (deep research)
sources:
  - theo-memory/packages/core/src/domain/principal.ts
  - theo-memory/packages/api/src/server/auth/middleware.ts
  - theo-memory/docs/adrs/ADR-0021-m8-boundary-enforced-user-isolation.md
  - theo-memory/README.md § Multi-tenancy & RBAC
verdict: SHIPPABLE
---

# Blueprint M11 — Isolamento por workspace

## Pergunta

Como o ecossistema Theo isola inquilinos, e o que exatamente o theo-skills precisa mudar —
sabendo que hoje `skillId` é **PRIMARY KEY global** (`schema.ts:59`) e não existe auth alguma?

## Coverage Corner 1 — O contrato de domínio

Três tipos, no `core/domain`, sem I/O:

```ts
interface Workspace { id: string; name: string; createdAt: Date }
type WorkspaceRole = 'owner' | 'admin' | 'member'
interface Principal { workspaceId: string; userId: string | null; role: WorkspaceRole; scopes: readonly string[] }
```

`Principal` responde **"de quem é esta credencial?"** (inquilino + capacidades), não apenas
"a credencial é válida?". Distinção deliberada: `role` governa **pertencimento** (quem
adiciona membro, quem cunha chave); `scopes` governa **capacidade sobre o dado**. São
ortogonais — um `owner` com escopo só-leitura não escreve.

`roleSatisfies(role, min)` compara por ranking (`member:0 < admin:1 < owner:2`). É o mesmo
predicado consultado pelo gate de rota e pelo guard anti-escalada.

## Coverage Corner 2 — Onde o isolamento é aplicado

**Aplicação, não banco** (ADR D8 do theo-memory): coluna `workspace_id` **denormalizada** em
toda tabela consultada diretamente, **primeira em todo `WHERE`**. Não usam RLS do Postgres.

O índice de deduplicação **lidera por `workspace_id`** — o mesmo fato, sob o mesmo usuário,
em dois workspaces são **duas linhas distintas**. Aplicado ao theo-skills: o mesmo `skillId`
em dois workspaces tem de ser duas skills.

**A lição do ADR-0021** (que eles aprenderam errando): tentaram tornar `userId` **obrigatório
no tipo** e isso quebrou o acesso de admin de workspace, cujo `Principal.userId` é
legitimamente `null`. Reverteram por ADR e passaram a aplicar o vínculo **na fronteira de
resolução de escopo**, mantendo o campo opcional. A regra que fica: **isolamento se aplica
onde a âncora de confiança é resolvida, não engessando o tipo**.

## Coverage Corner 3 — Ferramentas

Nada exótico: Drizzle (PK composta e índices liderados por `workspace_id`), Hono (`c.set`/
`c.get` para carregar o Principal no contexto), Postgres. Sem RLS, sem schema por inquilino,
sem banco por inquilino.

## Coverage Corner 4 — Técnicas (o que replicar)

1. **O Principal vem da credencial, nunca do corpo.** O `workspaceId` é injetado no servidor.
2. **`404`, nunca `403`, entre inquilinos.** Negar revela existência; a linha tem de ser
   invisível porque o filtro a exclui — não porque uma checagem a rejeitou.
3. **Default-deny.** Credencial sem vínculo resolve para o menor privilégio, jamais `owner`.
4. **Fail-closed.** Erro no backend de auth → **`503` explícito**, nunca um Principal padrão
   privilegiado. Comentário literal deles: *"NEVER fall through to a privileged default"*.
5. **`401` precede `403`.** Credencial ruim antes de privilégio insuficiente — a ordem inversa
   vaza existência de rota.
6. **Ponte legada.** Sem credencial, tudo colapsa num workspace `default` **fixo** (literal,
   não UUID aleatório), para a instalação single-tenant continuar funcionando.
7. **Isolamento provado contra banco real**, como hard gate — não mock.

## ADRs derivados para o theo-skills

### ADR-M11-1 — PK composta `(workspace_id, skill_id)`

Hoje `skillId` é PK **global** (`schema.ts:59`). Em SaaS isso é fatal: o primeiro inquilino a
registrar `deploy-helper` **bloqueia o nome para todos**, para sempre — agravado pela nossa
regra de reserva pós-delete.

**Decisão:** PK composta. A reserva pós-delete passa a ser por workspace.
**Migração em duas fases** (a PK é referenciada por revisões, embeddings, operações e
webhooks): (1) adicionar coluna + índice único novo; (2) trocar a PK. Ensaiada contra dump.
**Alternativa rejeitada:** prefixar o id (`acme/deploy-helper`) — empurra o inquilino para
dentro de um campo de domínio, e todo consumidor passa a ter de fazer parsing de string.

### ADR-M11-2 — Principal injetado, não lido de header

M11 entrega o **isolamento**; a **autenticação** é M12. A tentação é aceitar um header
`x-workspace-id` para poder testar — e isso seria um buraco: header é falsificável por
qualquer cliente.

**Decisão:** `createApp` recebe um `PrincipalResolver` (porta). O default resolve para o
workspace `default` (ponte legada). Os testes injetam resolvers distintos para provar
isolamento. M12 pluga o verificador real de credencial.
**Consequência:** nenhuma superfície nova de spoofing é criada por M11.

### ADR-M11-3 — Índices liderados por `workspace_id`

Todo índice de consulta passa a liderar pela coluna do inquilino. Inclui o **HNSW** do
pgvector — e é aqui que mora o risco de M11 (abaixo).

## Risco medido, não hipotético

**Filtro de inquilino sobre busca vetorial.** O índice `hnsw (vector_cosine_ops)` é global.
Filtrar ANN por `workspace_id` é o problema clássico **pre-filter vs post-filter**: ou o
recall degrada (o índice devolve K vizinhos e o filtro remove quase todos), ou o planner
abandona o índice e varre a tabela.

**Ameaça direta às metas de M4: Recall@5 ≥ 0.85 e p95 < 200ms.**

Mitigações a avaliar **com medição**, não por preferência:
- `iterative scan` do pgvector 0.8+ (o nosso é 0.5.1 — pode exigir bump da imagem);
- índice parcial por workspace (não escala para muitos inquilinos);
- pré-filtrar por FTS e reordenar por vetor no conjunto reduzido.

O número medido entra em ADR. **Sem medição, M11 não fecha.**

## O que este blueprint NÃO cobre

- Autenticação (M12), papéis e membros (M13), visibilidade pública (M14).
- Cobrança por inquilino — não está em nenhum milestone desta fase.
