---
slug: m31-retrieve-attribution
target_project: theo-skills
milestone_id: M31
created_at: 2026-08-03
goal: >
  Fazer o retrieve dizer QUAL perna trouxe cada resultado, sem segunda query,
  provado por um teste que reprova quando a atribuição mente.
---

# M31 — o contrato de leitura que as jornadas exigem

## Goal

Emitir, por resultado do `retrieve`, **quais pernas casaram e o rank em cada uma** — verificado
por um teste que **reprova** quando a atribuição afirma uma perna que não contribuiu.

Métrica observável única: `pnpm --filter @usetheo/skills test` passa com o novo teste de
discriminação, e **falha** quando a atribuição é forjada (provado invertendo-a).

## Context

O blueprint `knowledge-base/discoveries/blueprints/m31-skills-journeys-blueprint.md` (SHIPPABLE
100/100) descobriu que **a informação já existe e é jogada fora**. Este plano cobre as
recomendações R1, R2, R3 e R6 dele.

O que motiva agora: o M4 mediu recall carregada pelo FTS, com a perna vetorial isolada em
**0.308** sob o embedder stub. Um score único não distingue "achou porque as palavras batem" de
"achou porque entendeu" — e a auditoria de UX registrou que nenhuma tela expõe isso.

## Baseline Context (medido, não inferido)

### Files that will be touched

| Arquivo | LoC hoje | Último commit | Por que existe |
|---|---:|---|---|
| `packages/core/src/domain/retrievers/hybrid-retriever.ts` | 142 | `d90235c` 2026-08-01 | funde as duas listas por RRF; degrada se uma perna cair |
| `packages/core/src/domain/retrievers/types.ts` | — | — | contrato `RetrievedSkill` compartilhado pelos três retrievers |
| `packages/core/src/domain/retrievers/hybrid-retriever.test.ts` | — | — | única suíte que exercita `rrfFuse` |
| `packages/api/src/server/handlers/skills.ts` | **497** | `e5386a5` 2026-08-03 | rotas de skill — **a 3 LoC do orçamento de 500** |

### Current callers / dependents

`grep -rln "rrfFuse" packages/*/src packages/*/tests` devolve quatro:

- `packages/core/src/domain/retrievers/hybrid-retriever.ts` (definição)
- `packages/core/src/domain/retrievers/index.ts` (re-export)
- `packages/core/src/index.ts` (**índice público do pacote**)
- `packages/core/src/domain/retrievers/hybrid-retriever.test.ts`

**Consequência:** `rrfFuse` é API pública de `@usetheo/skills`. Mudar o **tipo de retorno** é
mudança de contrato publicado — por isso a D1 escolhe extensão aditiva, não substituição.

### Architecture boundaries affected

Nenhuma. A mudança vive inteira no domínio (`packages/core/src/domain/`) e chega à fronteira HTTP
sem tocá-la: `packages/api/src/server/handlers/retrieve.ts:99` passa `results` **direto** para
`c.json`. Estender `RetrievedSkill` propaga à resposta sem editar o handler.

### Domain glossary

| Termo | Definição |
|---|---|
| **perna** (leg) | um dos dois retrievers: `vector` (pgvector) ou `keyword` (Postgres FTS) |
| **RRF** | Reciprocal Rank Fusion — funde duas listas ranqueadas; cada uma contribui `1/(k+rank)` |
| **atribuição** | por resultado, quais pernas casaram e em que rank — o que este plano acrescenta |
| **degradação** | uma perna falhou; já sinalizado por `degraded.legs` na resposta |

## Prior Art & Related Work

- **Interno:** `knowledge-base/discoveries/blueprints/m31-skills-journeys-blueprint.md` — as duas decisões de fusão,
  e a comparação com `semantic-router` que rejeita a mistura no nível do vetor.
- **Interno:** o padrão `degraded.legs` em `handlers/retrieve.ts:100`, com o comentário que
  explica o "ausente significa íntegro". A atribuição é o **positivo** do mesmo eixo.
- **Externo (estudo, não copiado):** `knowledge-base/references/mcp-gateway-registry/registry/services/ard_search_service.py:127`
  — reescala score para 0-100. **Fora deste plano**: é lógica de tela (decisão de reescala do blueprint).
- Nenhuma skill `*-patterns` existe no repositório — verificado com `find .claude/skills -maxdepth 1 -type d -name "*-patterns"`.

## ADRs

### D1 — Estender `RetrievedSkill` com um campo aditivo, em vez de trocar o retorno

**Decisão:** acrescentar `matched?: readonly MatchedLeg[]` a `RetrievedSkill`, onde
`MatchedLeg = { leg: 'vector' | 'keyword'; rank: number }`. Opcional e ausente-significa-desconhecido.

**Rationale (cita `rules/architecture.md` — "o público de um pacote é o contrato; minimize-o"):**
`rrfFuse` é exportado do índice público. Trocar o tipo de retorno quebraria todo consumidor;
acrescentar campo opcional não quebra nenhum.

**Alternativas rejeitadas:**

1. **Devolver uma estrutura nova (`FusedResult`) em vez de `RetrievedSkill`.** Rejeitada: força
   todo caller a se adaptar por um ganho que um campo opcional já entrega. Viola YAGNI e a
   escada de parcimônia (rung 5).
2. **Rodar as duas buscas de novo só para a tela.** Rejeitada com evidência do blueprint:
   dobra a carga do caminho quente por informação já calculada, e duas execuções podem ranquear
   diferente se o acervo mudar entre elas.
3. **Misturar no nível do vetor, como o `semantic-router`.** Rejeitada: destrói a atribuição antes
   de existir similaridade e exige calibrar `alpha` — o comentário em `hybrid-retriever.ts:3`
   registra que RRF foi escolhido justamente por ser calibration-free.

### D2 — O rank exposto é 1-based; o interno continua 0-based

**Decisão:** `MatchedLeg.rank` é 1-based na saída.

**Rationale:** o consumidor é humano (tela) ou agente. "1º na vetorial" é legível; "0º" é
convite a off-by-one na leitura. O laço interno segue 0-based por causa da fórmula
`1/(RRF_K + rank)`, que depende disso.

**Alternativa rejeitada:** expor 0-based por simetria com o índice. Rejeitada: alinha o código e
desalinha o humano, e o contrato existe para o humano.

### D3 — `embedded` na listagem vem por `EXISTS`, não por `JOIN`

**Decisão:** `GET /v1/skills` devolve `embedded: boolean` por skill, resolvido com um
`EXISTS (SELECT 1 FROM embeddings ...)` correlacionado.

**Rationale (bottleneck):** a listagem é paginada e o `JOIN` com `embeddings` multiplicaria
linhas por revisão, exigindo `DISTINCT` — que força materialização e ordenação. `EXISTS`
curto-circuita no primeiro acerto e não altera a cardinalidade.

**Alternativa rejeitada:** contar embeddings e devolver o número. Rejeitada: ninguém pergunta
"quantos"; a pergunta é "é achável?". YAGNI.

## Fases

### Fase 1 — a atribuição nasce no domínio (R1 + R6)

#### Task 1.1 — `rrfFuse` carrega a perna de cada termo

**Why this step.** *Ação:* trocar o acumulador de `{skill, score}` para
`{skill, score, matched}` e alimentar `matched` em cada passada. *Raciocínio:* o blueprint
mediu que a informação já existe no fluxo — `accumulate(vectorResults)` e
`accumulate(keywordResults)` são passadas separadas, e a linha 67 (`existing.score += term`) só
executa quando a skill está nas duas. Não há nada a computar: há algo a não descartar.

**Files to edit:**
- `packages/core/src/domain/retrievers/types.ts` — acrescenta `MatchedLeg` e o campo `matched?`
- `packages/core/src/domain/retrievers/hybrid-retriever.ts` — acumulador + emissão
- `packages/core/src/domain/retrievers/hybrid-retriever.test.ts` — testes

**Deep file dependency analysis:** `rrfFuse` é reexportado por `retrievers/index.ts` e
`src/index.ts` (ver Baseline § Callers). Campo opcional ⇒ nenhum caller quebra. `accumulate` é
closure interna; ganha o parâmetro `leg`.

**TDD:**

```
RED  test_atribuicao_declara_as_duas_pernas_quando_a_skill_esta_nas_duas
     dado: vectorResults=[A], keywordResults=[A]
     então: A.matched === [{leg:'vector',rank:1},{leg:'keyword',rank:1}]

RED  test_atribuicao_nao_alega_perna_que_nao_contribuiu     ← R6, NÃO-OPCIONAL
     dado: vectorResults=[A], keywordResults=[]
     então: A.matched === [{leg:'vector',rank:1}]
     e:     nenhum elemento de A.matched tem leg==='keyword'

RED  test_rank_exposto_e_1_based
     dado: vectorResults=[A,B]
     então: B.matched[0].rank === 2
```

**Concurrency tests:** `(none — `rrfFuse` é função pura, síncrona, sem estado compartilhado)`.
O paralelismo do híbrido vive no `Promise.all` do chamador, cujo comportamento sob falha já é
coberto pelos testes de degradação existentes e não muda aqui.

**Acceptance criteria:**
- `matched` presente em todo resultado devolvido por `rrfFuse`.
- Nenhum caller existente alterado (campo opcional).
- O teste de discriminação **reprova** se `matched` for forjado — verificado invertendo a
  atribuição na implementação e observando o vermelho.

**DoD:** `pnpm --filter @usetheo/skills test` verde; `pnpm -r typecheck` verde.

### Fase 2 — a atribuição chega à fronteira (R2)

#### Task 2.1 — o contrato HTTP do retrieve reflete `matched`

**Why this step.** *Ação:* garantir, por teste de contrato, que `matched` aparece na resposta de
`GET /v1/skills:retrieve`. *Raciocínio:* `handlers/retrieve.ts:99` passa `results` direto para
`c.json`, então a propagação é automática — e é exatamente por isso que precisa de teste: o que
funciona por acidente de implementação quebra em silêncio quando alguém interpõe um `map`.

**Files to edit:**
- `packages/api/tests/contract/retrieve-attribution.contract.test.ts` **(NEW)**

**Deep file dependency analysis:** nenhuma edição de produção. O handler não muda; o teste trava
o comportamento emergente.

**TDD:**

```
RED  test_resposta_do_retrieve_carrega_matched_por_resultado
     asserta a FORMA (leg ∈ {vector,keyword}, rank ≥ 1), não valores fixos
```

**Failure scenarios:** com uma perna degradada, a resposta traz `degraded.legs` **e** o `matched`
dos resultados sobreviventes só cita a perna íntegra. O teste reproduz derrubando um retriever.

**Acceptance criteria:** contrato coberto; `degraded` e `matched` coerentes entre si.

**DoD:** `pnpm --filter @usetheo/skills-api test` verde.

### Fase 3 — a listagem distingue publicada de achável (R3)

#### Task 3.1 — `GET /v1/skills` devolve `visibility` e `embedded`

**Why this step.** *Ação:* acrescentar as duas colunas à projeção da listagem. *Raciocínio:* a
auditoria de UX mediu que o painel não distingue *publicada* de *achável*; sem `embedded` a
métrica "descobríveis" do M31 não existe. `visibility` já é escrito por `PUT .../visibility` e
nunca foi lido de volta.

**Files to edit:**
- `packages/api/src/server/store/skills-store.ts` (387 LoC) — projeção da listagem
- `packages/api/tests/contract/skills-list-fields.contract.test.ts` **(NEW)**

> **Corrigido no edge-case review.** A v1 deste plano citava
> `packages/core/src/domain/skills-store.ts`, que **não existe** — citação fabricada, hard cap do
> `plan-confidence`. O módulo real é `packages/api/src/server/store/skills-store.ts`, com 387 LoC.
>
> Isso também **dissolve** o risco de orçamento: a listagem NÃO vive em `handlers/skills.ts`
> (497 LoC, no limite), e sim no store, que tem folga. `visibility` já existe no schema e é usado
> num `WHERE` (`skills-store.ts:323`) — a mudança é de **projeção**, não de schema.

**TDD:**

```
RED  test_listagem_devolve_visibility
RED  test_listagem_marca_embedded_false_para_skill_sem_embedding   ← o caso que importa
```

**Failure scenarios:** banco indisponível na subconsulta — o `EXISTS` faz parte da mesma query;
não há segunda chamada a falhar isoladamente.

**Acceptance criteria:** os dois campos presentes; `embedded=false` para skill sem embedding.

**DoD:** suítes verdes; `EXPLAIN` da listagem sem `DISTINCT` introduzido (D3).

### Fase 4 — Integration Validation

- `pnpm -r build`, `pnpm -r lint`, `pnpm -r typecheck`
- `pnpm -r test` (core, api, cli, mcp, sdk)
- `node scripts/check-declared-deps.mjs` e `node scripts/check-publish-artifacts.mjs`
- **Prova de discriminação:** inverter a atribuição na implementação e confirmar que a suíte
  **reprova** — um teste que não falha quando deveria não é gate.

## Coverage Matrix

| Requisito (origem) | Task | Coberto |
|---|---|---|
| R1 — `rrfFuse` carrega o termo de cada perna | 1.1 | sim |
| R2 — `:retrieve` devolve a atribuição | 1.1 + 2.1 | sim |
| R3 — listagem devolve `visibility` e `embedded` | 3.1 | sim |
| R6 — teste que discrimina a perna (não-opcional) | 1.1 (RED 2) + Fase 4 | sim |
| DoD M31 "descoberta observável" | 1.1, 2.1 | sim |
| DoD M31 "contrato de leitura sustenta as telas" | 3.1 | sim |

**Cobertura: 100%.** Nenhum requisito sem task.

## Drawbacks & Risks

| # | Risco | Severidade | Mitigação | Dono |
|---|---|---|---|---|
| 1 | `matched` cresce a resposta do retrieve — até 2 entradas por resultado | **baixa** | dois inteiros e duas strings curtas por item; `topK` já limita o conjunto. Se medir custo, o campo é opcional e pode virar opt-in por query param | implementador |
| 2 | A atribuição pode **mentir** se o acumulador for alimentado errado, e mentir com aparência de dado | **alta** | é exatamente o R6: o teste de discriminação reprova quando a atribuição alega perna que não contribuiu. Mesma classe do LT-035, onde o agregado diluía e o portão passava com metade do sistema morto | implementador |
| 3 | ~~`handlers/skills.ts` a 3 LoC do teto de 500~~ **dissolvido no edge-case review** | — | a listagem vive em `store/skills-store.ts` (387 LoC), não no handler. O risco era real sobre uma premissa errada — registrado em vez de apagado, porque a próxima pessoa a ler o arquivo de 497 LoC vai ter a mesma dúvida | — |
| 4 | `visibility` já é escrito e nunca lido de volta — pode haver linha antiga com valor inesperado | baixa | o teste de contrato asserta a FORMA (valor ∈ conjunto conhecido), não um valor fixo; linha divergente aparece como falha, não como campo silencioso | implementador |

## Failure scenarios

O plano toca I/O externo (Postgres, via os dois retrievers e a listagem). Um cenário por
dependência, com como o teste o reproduz e o comportamento esperado:

- **Perna vetorial cai (pgvector indisponível ou erro de query).** *Reprodução:* o teste injeta
  um retriever que rejeita. *Esperado:* a resposta traz `degraded.legs: ['vector']` **e** o
  `matched` dos resultados sobreviventes cita **apenas** `keyword`. É o caso que prova que a
  atribuição não mente sob degradação — se ela alegasse `vector` aqui, seria um campo com
  aparência de dado e conteúdo falso.
- **Perna léxica cai (FTS indisponível).** *Reprodução:* simétrica à anterior. *Esperado:*
  simétrico — `degraded.legs: ['keyword']`, `matched` só com `vector`.
- **As duas caem.** *Reprodução:* ambos os retrievers rejeitam. *Esperado:* comportamento atual
  preservado (o híbrido já trata; este plano não o altera) — nenhum resultado, e `degraded`
  citando as duas. Nenhum `matched` a emitir.
- **Banco indisponível na listagem (`EXISTS` do `embedded`).** *Reprodução:* a subconsulta faz
  parte da mesma query da listagem. *Esperado:* falha única, tratada como qualquer erro de
  leitura — **não há segunda chamada a falhar isoladamente**, que é justamente por que a D3
  escolheu `EXISTS` correlacionado em vez de uma consulta separada.

## Unresolved Questions

- Q1 — O campo `matched` deve aparecer também quando `strategy` é `lexical` ou `vector` puro?
  Inclinação: sim, com uma única entrada — é mais previsível para o consumidor do que um campo
  que aparece só no modo híbrido. Decidir na Task 1.1; não bloqueia o início.
- Q2 — Vale expor o termo RRF bruto (`1/(k+rank)`) por perna, além do rank? Inclinação: não — o
  rank responde "qual perna trouxe", e o termo é derivável dele com `RRF_K`, que é constante
  conhecida. Expor os dois seria redundância no contrato. Reavaliar se a tela pedir.

## Dependencies

Nenhuma dependência nova — o plano é aditivo sobre `pg`, `drizzle-orm` e `pgvector` já declarados.

**Mas a afirmação "nada a auditar" que estava aqui era falsa**, e o `/deps-audit` a desmentiu:
`pnpm audit --prod` reporta **4 CVEs moderate** pré-existentes. Corrigido para o que a medição
mostra, com a triagem que separa o que importa do que não se aplica:

| Pacote | Advisory | Corrigido em | Temos | Aplica-se a nós? |
|---|---|---|---|---|
| `@hono/node-server` | `GHSA-frvp-7c67-39w9` — path traversal | ≥ 2.0.5 | `^1.13.0` | **Sim** — é o adaptador que servimos |
| `hono` | `GHSA-hvrm-45r6-mjfj` — `hono/jsx` sem isolamento por requisição | ≥ 4.12.27 | `^4.12.25` | Não — não usamos `hono/jsx` |
| `hono` | `GHSA-w62v-xxxg-mg59` — XSS via `cx()` do JSX | ≥ 4.12.27 | `^4.12.25` | Não — idem |
| `hono` | `GHSA-xgm2-5f3f-mvvc` — adaptador API Gateway v1 | ≥ 4.12.27 | `^4.12.25` | Não — não usamos API Gateway |

**Verdict do gate: `FAIL_MEDIUM` (cap 70)** — MEDIUM não bloqueia como CRITICAL/HIGH
(`deps-audit-golden-rule.md` § 1), mas fica registrado em vez de silenciado.

**Fora do escopo DESTE plano, e por quê:** o bump de `@hono/node-server` é **major** (1.x → 2.x)
e mexe na fronteira HTTP inteira — misturá-lo com uma mudança aditiva de contrato de leitura
tornaria impossível atribuir uma regressão a um dos dois. Filado em issue própria.

## Global Definition of Done

- Todas as suítes verdes; `typecheck` e `lint` limpos.
- Cobertura não regride.
- Nenhum arquivo tocado ultrapassa 500 LoC (`rules/architecture.md`).
- Mudanças **aditivas**: nenhum consumidor existente quebra — provado pelos testes atuais
  passando sem edição.
- A prova da Fase 4 executada: a suíte **reprova** com atribuição forjada.
