# Followups — english-only-sweep

Achados que apareceram durante a implementação e que **não** entram no commit corrente (anti-pattern: scope-creep mid-task). Cada um traz a evidência que o sustenta.

## F-1 — `tests/workflows/**` está fora de qualquer projeto TypeScript

**Descoberto em:** T0.1, ao cobrir `tests/repo/**` com um `tsconfig.json` de raiz.

**Fato medido:** antes desta tarefa, **nenhum** arquivo sob `tests/` pertencia a um projeto TS. Consequências:

- `npx eslint tests/workflows/` falha com `Parsing error: ... was not found by the project service` — os arquivos nunca foram lintados.
- `pnpm lint` na raiz é `pnpm -r lint`, que roda o lint **por pacote**; `tests/` não pertence a pacote nenhum, então o CI nunca os viu.
- Ao incluí-los experimentalmente: **7 erros de tipo** (`TS4111` em `gates.test.ts`, acesso a `jobs` por index signature) e **8 erros de lint** (`no-explicit-any` ×3, `no-unsafe-member-access` ×5).

**Por que não foi corrigido aqui:** é dívida preexistente, anterior a este plano. Puxá-la para o commit de T0.1 misturaria a correção de 15 erros alheios com a entrega do portão, e tornaria o diff irrevisável. O `tsconfig.json` criado em T0.1 tem `include` deliberadamente escopado em `tests/repo/**`, com o motivo escrito no próprio arquivo.

**Ação sugerida:** tarefa própria — estender o `include` para `tests/**`, corrigir os 15 achados, e acrescentar um step de lint de raiz ao `ci.yml` (hoje `pnpm lint` não alcança `tests/`).

## F-2 — Existe um TERCEIRO arquivo com nome em português; o plano lista dois

**Descoberto em:** T0.1, na primeira varredura real.

**Fato medido:** o tier D encontrou 3 nomes de arquivo em PT no produto:

```
docs/integracao-theokit-mcp.md
packages/api/tests/integration/m28-execution-nao-confiavel.integration.test.ts
packages/api/tests/integration/m29-adoption-versao-real.integration.test.ts   <- NÃO está no plano
```

A T6.1 do plano nomeia apenas os dois primeiros nos seus `git mv`.

**Ação sugerida:** acrescentar `m29-adoption-versao-real.integration.test.ts` à T6.1 quando o plano for revisado para a fase 6 (e confirmar que `vitest.integration.config.ts` casa por glob, não por lista).

## F-3 — Existe um SEXTO export em português; a T2.1 lista cinco

**Descoberto em:** T0.1, ao corrigir o tier A.

**Fato medido:** dos 429 nomes exportados sob `packages/<pkg>/src`, **6** são portugueses:

```
CandidataVizinha  ·  Diagnostico  ·  EntradaDiagnostico  ·  EstadoDaRevisao
diagnosticarDescobribilidade
registrarErroDePoolOcioso        <- NÃO está no mapa de rename da T2.1
```

O mapa de rename da T2.1 cobre os cinco primeiros (os do módulo de descobribilidade) e não menciona `registrarErroDePoolOcioso`.

**Ação sugerida:** acrescentar a linha ao mapa de rename da T2.1. Antes disso, confirmar se o símbolo é reexportado pelo barrel — se for, o rename é quebra de contrato como os outros e entra na mesma nota de migração; se não for, é interno e cai na fase 5.

## F-4 — `.claude/knowledge-base/acceptance/evidence/` tem 4 arquivos com nome em PT

**Descoberto em:** T0.1, ao decidir o escopo do tier D.

**Fato medido:** `M30-rota-nao-exercitavel.txt`, `M31-AC2-defeito-origem-nao-informada.png`, `M31-AC3-erro-field-e-linha.png`, `M31-AC3-erro-posicionado.png`.

**Decisão tomada em T0.1 (não é followup, é escopo):** `.claude/` inteiro está fora do alcance do portão. São artefatos do próprio ciclo, e renomear um arquivo de evidência **quebra o registro de aceitação que o cita**. A exclusão está escrita em `IGNORED_ROOTS` com a razão ao lado.

**Fica registrado aqui** apenas para que a ausência desses nomes na contagem não seja lida, mais tarde, como se eles não existissem.
