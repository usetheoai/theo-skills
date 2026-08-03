# Review — m31-retrieve-attribution

Date: 2026-08-03
Plano: `.claude/knowledge-base/plans/m31-retrieve-attribution-plan.md` (SHIPPABLE 98.8)
Code-quality: **PASS**, 0 findings, 0 caps
Escopo auditado: 9 arquivos, +316/−8

## Hard gates (`cycle-review`)

| Gate | Estado |
|---|---|
| Testes verdes na branch | **5 pacotes** — core 119, api 166, cli 79, mcp 45, sdk 19 |
| Segredos novos commitados | 0 |
| Commit direto em `main` | não — tudo em `workspace` |
| `Co-Authored-By` em algum commit | 0 |
| CHANGELOG atualizado | sim (bloqueado pelo hook antes, corrigido) |

Nenhum BLOCKER.

## Cross-validation: o plano prometeu × o código entrega

| Task | Prometido | Entregue | Veredito |
|---|---|---|---|
| 1.1 | `rrfFuse` carrega o termo de cada perna | `matched: MatchedLeg[]` no acumulador; `leg` como parâmetro | **cumprido** |
| 1.1 (R6) | teste que reprova quando a atribuição mente | prova de mutação executada — suíte reprova com `leg` forjado | **cumprido com prova** |
| 2.1 | contrato HTTP reflete `matched` | 3 testes de contrato, sem banco | **cumprido** |
| 3.1 | `visibility` + `embedded` na listagem | projeção com `EXISTS` correlacionado | **cumprido, com desvio de nível declarado** |
| D2 | rank 1-based na saída, 0-based interno | teste explícito para os dois | **cumprido** |
| D3 | `EXISTS`, não `JOIN` | `EXISTS` correlacionado por `latestRevisionId` | **cumprido** |

## Findings

### HIGH-1 — tríade de wiring incompleta (CORRIGIDO nesta revisão)

**Achado.** O plano cobria caller e teste de integração, mas **não a métrica de runtime**, que
`cycle-implement § Wiring triad` exige. `handlers/retrieve.ts` logava `top_score` e nada sobre
atribuição.

**Por que importa mais do que parece.** O M4 mediu que a recall é carregada pelo FTS — perna
vetorial isolada em **0.308** sob o embedder stub. Essa medição foi **offline, numa avaliação**.
Em produção não havia sinal algum: a atribuição existiria na resposta (para quem integra) e
seria invisível para quem **opera**. O defeito que o M31 existe para tornar visível continuaria
invisível no ambiente onde ele custa dinheiro.

**Correção.** `matched_vector` e `matched_keyword` na linha `retrieve`, com cardinalidade fixa
(dois inteiros, nunca a lista de skills — métrica por skill viraria alta cardinalidade). Coberto
por teste. Suíte da api: 165 → 166.

### MEDIUM-1 — RED-GREEN invertido na Task 3.1 (aceito, com mitigação)

Implementação escrita antes do teste. A prova de mutação (`embedded` sempre `TRUE` → suíte
reprova) restaura a garantia que a ordem daria, mas não a disciplina. Registrado no commit e
aqui, em vez de silenciado.

### MEDIUM-2 — nível de teste divergiu do plano na Task 3.1 (aceito, e correto)

O plano pedia contract test; foi escrito como integração. **A divergência é o acerto:** uma
projeção com `EXISTS` correlacionado só se prova contra o Postgres real — um duplo devolveria o
que se mandasse e provaria apenas que se sabe escrever duplos. Escrever no nível errado para
bater com o texto do plano seria cumprir a letra e perder o propósito.

### LOW-1 — `visibility` é `string`, não união literal

`SkillView.visibility` foi tipado como `string`, espelhando a coluna (`text`). Uma união
(`'private' | 'public'`) daria checagem em tempo de compilação. **Não corrigido de propósito:** a
coluna é `text` livre desde o M14 e pode conter valor histórico fora da união; estreitar o tipo
faria o TypeScript prometer o que o banco não garante. O teste asserta a forma justamente por
isso.

## Bottlenecks — a análise que o milestone pediu

| Ponto | Custo | Evidência |
|---|---|---|
| `rrfFuse` com atribuição | **zero query nova**; um objeto `{leg, rank}` por par (resultado, perna), no mesmo laço que já rodava | o acumulador já iterava as duas listas |
| `matched` na resposta | ≤ 2 entradas por resultado, e `topK` limita o conjunto | contrato |
| `embedded` na listagem | `EXISTS` correlacionado, curto-circuita no primeiro acerto, não altera cardinalidade | D3; índice `embeddings_revision_provider_model_uq` cobre a coluna |
| Métrica de wiring | dois `filter` sobre um array já materializado, tamanho `topK` | `handlers/retrieve.ts` |

**Nenhuma segunda query foi introduzida no caminho quente** — que era a restrição explícita do
milestone.

## Verdict

**READY_TO_MERGE.** Zero BLOCKER. Um HIGH encontrado **e corrigido dentro desta revisão**; dois
MEDIUM aceitos com mitigação declarada; um LOW deliberadamente não corrigido, com razão.

O que dá confiança não é a suíte verde — é que **duas provas de mutação** demonstraram que a
suíte fica vermelha quando o comportamento mente. Um teste que não falha quando deveria não é
gate, e este ciclo tinha exatamente essa classe de defeito na origem (LT-035).
