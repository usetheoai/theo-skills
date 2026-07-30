# WIP — trabalho preservado, não aplicado

## `m11-stores-escopados.patch` (400 linhas)

Segunda fase do M11: os stores passam a nascer **escopados a um workspace**
(`createSkillsStore(db, workspaceId)`) em vez de receberem `workspaceId` por método.

**Por que a factory e não parâmetro por método:** são 52 operações no conjunto dos 5 stores.
Com o inquilino como parâmetro, basta UMA chamada esquecida para vazar o catálogo de outro
cliente — e o compilador não ajuda, porque o parâmetro estaria lá, só preenchido errado.
Escopando na construção, o filtro deixa de ser disciplina e vira estrutura. É o mesmo desenho
do `memory.withWorkspace('acme')` do theo-memory.

O patch contém, prontos e revisados:

- `skills-store.ts` — 17 operações filtradas, `refreshSearchText` com o inquilino no `WHERE`
- `revisions-store.ts` — inclusive `getById`, que filtra por inquilino MESMO com `revisionId`
  único: sem isso, quem descobrisse o id de uma revisão alheia leria o payload de outro cliente
- `operations-store.ts`, `embeddings-store.ts`, `webhook-endpoints-store.ts`
- `app.ts` — `PrincipalResolver` como PORTA (nunca cabeçalho, ADR-M11-2), Principal resolvido
  uma vez por requisição, stores construídos já escopados

**Por que não foi aplicado:** falta a atualização dos 17 pontos de consumo nos handlers
(`deps.skillsStore.x()` → `deps.skillsStoreFor(ws).x()`), mais `wiring.ts`, `server.ts` e os
testes de integração. Aplicar o patch sem isso deixa o typecheck vermelho.

**Como retomar:**

```bash
git apply knowledge-base/wip/m11-stores-escopados.patch
pnpm --filter @usetheo/skills-api exec tsc --noEmit -p tsconfig.json   # lista os callers
```

O compilador aponta exatamente cada ponto a ajustar — o guard estrutural funcionando.
Depois: suíte de isolamento cruzado (T4.1), guard mecânico (T4.2) e a medição de
Recall@5/p95 com filtro (T5.1), que é o risco central e sem a qual M11 não fecha.
