# Arquitetura — theo-skills

Declaração de conformidade com o **Theo Architecture Standard**
(`theo-memory/docs/ARCHITECTURE.md`), que se declara referência canônica de todo repositório
do ecossistema: *"All repos MUST conform. Deviations require an ADR."*

Este documento diz o que seguimos, **e onde divergimos** — com o ADR de cada divergência.
Uma declaração de conformidade que não lista desvios não é conformidade, é omissão.

## Camadas

```
packages/cli        interface — CLI de dev e de instalação
packages/api        interface (HTTP) + infraestrutura (stores, adapters)
packages/core       domínio: contratos, políticas, portas (DIP)
```

`core` não importa `api` nem `cli`. Os stores implementam portas declaradas no domínio; o
composition root é `createApp` (`packages/api/src/server/app.ts`).

## Multi-tenancy

Adotado do padrão: `Principal { workspaceId, userId, role, scopes }` resolvido **na
fronteira**, nunca lido do corpo da requisição, com `workspace_id` denormalizado e primeiro em
todo `WHERE`.

**A forma de garantir isso é estrutural, não disciplinar.** Stores e retrievers são criados
por *factory* escopada — `createSkillsStore(db, workspaceId)`, `createKeywordRetriever({ executor, workspaceId })`
— então não existe caminho de código que produza um acesso sem tenant. A alternativa (passar
`workspaceId` como parâmetro de cada chamada) deixa o esquecimento compilar.

Acesso cross-tenant devolve **404**, nunca 403: um 403 confirma que o recurso existe, e isso
já permite enumerar o que outro cliente publicou.

## Autenticação e autorização

Dois eixos **ortogonais**, e confundi-los é o erro que a ADR 0007 documenta:

| eixo | governa | exemplo |
|---|---|---|
| `scopes` | capacidade sobre o dado | publicar exige `skills:publish` |
| `role` | pertencimento ao workspace | administrar membros exige `admin` |

Ordem de resposta fixada por teste: **401 → 403 → 503**. Credencial inválida sai como 401
mesmo em rota que exige scope — deixar o 403 vir primeiro daria a quem não tem credencial um
oráculo para mapear a API. Backend de auth indisponível responde **503**, nunca acesso.

## Desvios do padrão, com ADR

| Desvio | Por quê | ADR |
|---|---|---|
| Port `AuthVerifier` só com `resolvePrincipal` | O `theo-memory` mantém um `verify(token): boolean` legado por uma janela de migração com ~12 consumidores. O theo-skills não os tem; nascer com o contrato certo evita a dívida em vez de herdá-la. | — (parsimony ladder rung 1) |
| Scopes em **cadeia**, não planos | No `theo-memory` a implicação é plana (`platform-admin ⊇ admin`). Aqui publicar pressupõe escrever e escrever pressupõe ler, porque quem publica uma skill necessariamente a lê de volta. | ADR 0007 |
| Payload em `bytea`, sem object storage | Revisão e payload commitam na **mesma transação**. Com S3 seriam duas fases mais um coletor de órfãos, para um gargalo que a medição diz não existir (p90 ≤ 1.2 MB). | ADR 0005 |
| Publicar governado por **scope**, não por papel | Exigir `admin` para publicar forçaria todo desenvolvedor a virar administrador — ganhando junto o direito de remover colegas. | ADR 0007 |
| Rate limit **em memória**, sem Redis | Restrição de stack declarada no ROADMAP. Consequência assumida: com N réplicas o limite efetivo é N × limite. Contém abuso acidental; **não** é suficiente contra abuso deliberado, cujo lugar é a borda. | — (declarado no código) |
| Resolver de distribuição **não** escopado por workspace | Única exceção ao padrão de factory: quem apresenta o token é o cliente de um publisher que ainda não sabemos qual é. Descobrir o workspace é o *resultado* da resolução. | ADR 0005 § M20 |

## Observabilidade

Uma linha estruturada por requisição, com `trace_id` propagado pelo módulo do M9 —
`resolveTraceId` honra um `traceparent` recebido e gera um novo quando falta. **Não há
segunda implementação de propagação**: um segundo id quebraria a correlação entre HTTP,
operação, job e webhook.

Latência agregada **por padrão de rota** (`/v1/skills/:id`), nunca por valor — agregar por
identificador criaria uma série por skill, cardinalidade ilimitada.

SLO de retrieve: **p95 < 200 ms**, verificável por `checkRetrieveSlo`. Números medidos em
`benchmarks/`.

## Categorias de teste

| categoria | onde | contra o quê |
|---|---|---|
| contrato / unidade | `tests/contract/`, co-locado | sem I/O |
| integração | `tests/integration/` | `ankane/pgvector` real |
| E2E | `vitest.e2e.config.ts` | fluxos críticos ponta a ponta |

Testes de concorrência (last-owner, bootstrap de uso único) são **de integração por
necessidade**: um mock de transação serializa sempre e aprovaria a implementação sem
`FOR UPDATE`.
