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

## F-5 — O teste de contrato do binário roda contra `dist/`, sem guarda de frescor

**Descoberto em:** T1.1, ao restaurar `bin.ts` depois da prova de regressão.

**Fato medido:** `bin.contract.test.ts:9` aponta para `packages/mcp/dist/bin.js`. Restaurei o fonte e rodei a suíte: **falhou**, porque o `dist/` ainda continha a injeção do teste anterior. O erro (`expected 'theo-skills mcp: THEOSKILL_REGISTRY e…' not to contain …`) descreve com precisão um estado que o fonte já não tinha.

Rodar contra o binário é deliberado e correto — é o que o DoD do M25 pede. O que falta é o **frescor**: nada relaciona `dist/bin.js` ao `src/bin.ts` que o gerou, então a suíte pode passar (ou falhar) por um build velho, e a mensagem não dá pista de que o problema é esse.

**Ação sugerida:** ou o `pretest` do pacote roda `build`, ou o teste compara o mtime de `dist/bin.js` com o de `src/bin.ts` e falha com "dist stale — run `pnpm build`". A segunda é mais barata e diz o que fazer.

## F-6 — O mini review deriva símbolos de arquivos de DADOS e os atribui à fase

**Descoberto em:** fronteira da fase 1, ao ler o veredito `PHASE_REVIEW_NEEDS_FIX`.

**Fato medido:** o mini review da fase 1 emitiu **9 findings HIGH** `wiring_pillar_a_fail`, sobre `ApiKeyRow`, `BundleItemRow`, `DistributionTokenRow`, `SkillRevisionRow`, `WebhookEndpointRow`, `WorkspaceUserRow`, `assertPublishable` e outros dois.

Nenhum deles foi introduzido pela fase 1:

```
git grep -l assertPublishable 88d4fa4 -- packages
  -> packages/core/src/domain/version.ts        (existe ANTES do plano)
git grep -l ApiKeyRow 88d4fa4 -- packages
  -> packages/core/src/infrastructure/db/schema.ts

git diff --name-only 4f16a61~1..HEAD | grep packages/.*/src
  -> packages/core/src/domain/discoverability.test.ts        (um arquivo, e e teste)
```

**Causa:** T1.3 lista `tests/repo/core-api-surface.json` em `files` — corretamente, porque a tarefa criou o arquivo. Mas o conteúdo dele é uma **lista dos 34 nomes exportados pelo pacote**, e o mini review a leu como símbolos que a fase introduziu. Um arquivo de dados que cita nomes vira, para o revisor, uma fase que os declara.

**Consequência:** o veredito da fase é `NEEDS_FIX` por dívida repo-wide preexistente. Pior, ela é dívida **real** — `assertPublishable` sem chamador é o achado #2 do `/code-review`, e é exatamente o que a T4.1 deste plano existe para corrigir. O revisor está certo sobre o fato e errado sobre o dono.

**Ação sugerida:** `mini_review.py` deve derivar símbolos apenas de arquivos de código (`.ts`/`.py`/`.go` fora de `*.json`/`*.snap`), ou aceitar uma marcação de "arquivo de dados" no checkpoint. Enquanto não houver, um snapshot de superfície listado em `files` reprova qualquer fase que o crie.

**O que NÃO fizemos:** remover o snapshot de `files` para obter verde. A tarefa criou o arquivo; omiti-lo seria falsear o registro para passar num portão — o oposto do que este plano inteiro defende.

## F-7 — `check_checkpoint_consistency` varre TODO o histórico, e os IDs de tarefa colidem entre planos

**Descoberto em:** Step 5, no `run_validation.py`.

**Fato medido:** 8 findings HIGH `task_committed_in_git_not_in_progress` para T2.1, T2.2, T3.1, T3.2, T3.3, T4.1, T4.2 e T5.1 — tarefas que esta invocação **nunca tentou**. A origem é o histórico de outros planos:

```
d6392a0 feat(lifecycle): colunas e constraints do ciclo de vida (T2.1)      <- plano M32
b5507a4 feat(lifecycle): a descoberta esconde ... (T3.1, T3.2, T4.1)        <- plano M32
f24ff10 feat(lifecycle): a operacao de deprecar ... (T5.1)                  <- plano M32
f16094c feat(m9): T4.1+T4.2 — test marker taxonomy ...                      <- plano M9
```

A convenção `T{N}.{M}` é **a mesma em todos os planos do repositório**, e o checker não delimita a busca aos commits deste plano. Qualquer plano com mais de uma fase vai colidir com o histórico de qualquer plano anterior.

**Consequência:** o gate reporta como "tarefa concluída sem atualizar o checkpoint" o que é, na verdade, trabalho de outra entrega, feito meses antes. Quanto mais o repositório amadurece, mais falsos positivos — e um gate que sempre reprova é um gate que se aprende a ignorar.

**Ação sugerida:** delimitar a varredura ao intervalo do plano — `git log <base>..HEAD`, onde `<base>` é o commit anterior ao primeiro do plano (registrável no `.progress` no início da execução) — ou exigir que a mensagem cite o slug além do ID (`T2.1 [english-only-sweep]`).

## F-8 — O critério de ≤ 500 linhas é aplicado a arquivos que não são código

**Descoberto em:** Step 5, no `check_acceptance_criteria`.

**Fato medido:** dois HIGH `file_size_exceeded`:

- `CHANGELOG.md` — 503 linhas. É **append-only por contrato** (Regra Inquebrável 6): cresce a cada entrega, para sempre. Um teto de 500 linhas nele significa que a próxima entrada de qualquer pessoa reprova o gate.
- `tests/repo/core-api-surface.dts.snap` — 3395 linhas. É **dado gerado** (o snapshot da superfície de tipos), não código escrito. Seu tamanho é o tamanho da API do pacote.

O critério do plano diz "todo arquivo alterado ≤ 500 linhas" sem qualificar. O orçamento existe para conter **complexidade de código**; aplicá-lo a um log append-only e a um snapshot mede a coisa errada.

**Ação sugerida:** qualificar o critério no plano — o teto vale para arquivos de código-fonte, e o gate deve pular `CHANGELOG.md`, `*.snap`, `*.json` de fixture e `*-lock.*`.
