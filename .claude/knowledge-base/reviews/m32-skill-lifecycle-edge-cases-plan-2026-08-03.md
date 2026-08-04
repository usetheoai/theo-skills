# Edge Case Review — m32-skill-lifecycle (plano de implementação)

Date: 2026-08-03
Plan analyzed: `.claude/knowledge-base/plans/m32-skill-lifecycle-plan.md` (v1.0)
Tasks analyzed: 8
Cases found: 6 (EDGE: 2, NEGATIVE: 4 | MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: o plano se contradiz sobre a constraint da coluna

- **Affected task:** T2.1
- **Kind:** NEGATIVE (invalid input)
- **Family:** State
- **Scenario:** a T2.1 declara o teste RED
  `lifecycle_column_rejects_value_outside_vocabulary` e justifica-o chamando o
  `state: text('state')` atual de *"anti-exemplo"*. Mas o próprio plano manda declarar a coluna como
  `text()` derivando o tipo do union TypeScript — e **tipo TypeScript não vira constraint no
  Postgres**. Medido: `packages/core/src/infrastructure/db/schema.ts` linha 12 (`state`) e linha 24
  (`visibility: text('visibility').notNull().default('private')`) — o repo inteiro usa `text()` com
  default e **zero** CHECK.
- **Impact:** o teste RED nunca fica verde por implementação — ele só passaria se a constraint
  existisse. O implementador ou apaga o teste (perdendo a garantia que o plano prometeu) ou descobre
  a contradição no meio da fase.
- **Suggested fix:** T2.1 adiciona **CHECK constraint** explícito na migração
  (`lifecycle IN ('active','draft','deprecated')`), divergindo conscientemente do precedente de
  `visibility`/`state` — que é exatamente o que o plano chamou de anti-exemplo. Registrar como ADR
  D5.

### EC-2: `handlers/skills.ts` estoura o teto de 500 LoC na T4.1

- **Affected task:** T4.1
- **Kind:** EDGE (extremo de valor válido)
- **Family:** Resource
- **Scenario:** o arquivo tem **497 LoC** (medido). A T4.1 acrescenta parse e validação de três flags
  — no mínimo ~15 linhas. O plano registra isso como risco "Baixa" e diz "se estourar, extrair", o
  que empurra a decisão para o meio da implementação.
- **Impact:** o gate de tamanho falha no fim da fase, com o trabalho já feito, forçando refactor
  não planejado — retrabalho, que o dono proibiu explicitamente.
- **Suggested fix:** T4.1 extrai o parse das flags para
  `packages/api/src/server/handlers/lifecycle-flags.ts` **desde o início**, não condicionalmente.
  Os dois handlers (retrieve e listagem) importam de lá — o que também elimina a duplicação que o
  próprio REFACTOR da task antecipava.

### EC-3: o teste "discriminante" da T3.2 pode ser commitado com o filtro temporário

- **Affected task:** T3.2
- **Kind:** NEGATIVE (falha de processo)
- **Family:** State
- **Scenario:** a task manda provar que o teste discrimina **adicionando temporariamente** o filtro ao
  `get` e confirmando a reprovação. Se essa edição for commitada por engano, o milestone entrega o
  oposto do que promete: a deprecada deixa de resolver.
- **Impact:** quebra silenciosa de consumidor — precisamente o defeito que o M32 existe para impedir.
- **Suggested fix:** a prova de discriminação roda **em worktree separado ou com `git stash`**, e a
  DoD da T3.2 ganha o item `git diff --exit-code packages/api/src/server/store/skills-store.ts`
  limpo após a prova.

## SHOULD TEST

### EC-4: linha com `lifecycle` NULL na janela entre migração e deploy

- **Affected task:** T2.1, T3.1
- **Kind:** EDGE (extremo válido)
- **Suggested test:** `row_with_null_lifecycle_is_treated_as_active` — inserir NULL diretamente por
  SQL (contornando o default) e asseverar que a skill **aparece** na busca. O plano já cita o caso em
  Deep Dives da T3.1, mas não o transformou em teste nomeado. Falha na direção perigosa: um NULL
  tratado como "não-active" esconderia a skill sem ninguém pedir.

### EC-5: `supersededBy` apontando para uma skill que é deprecada depois

- **Affected task:** T5.1
- **Kind:** NEGATIVE (estado inconsistente)
- **Suggested test:** `successor_can_itself_be_deprecated_without_breaking_the_pointer` — a validação
  da T5.1 confere que a sucessora existe **no momento da escrita**; nada impede que ela seja
  deprecada depois, criando uma cadeia de deprecadas. Assevere que o ponteiro continua legível e não
  quebra a leitura. Proibir seria caro (exigiria varredura reversa a cada deprecação) e YAGNI.

## DOCUMENT

### EC-6: o default `active` na migração é uma decisão de risco assumida

- **Kind:** EDGE
- **Accepted risk:** a T2.1 marca **toda** linha existente como `active`, inclusive as que o dono
  consideraria rascunho. É deliberado — marcar como `draft` esconderia skills em produção no momento
  da migração. A consequência aceita: quem tinha rascunhos "de fato" precisa deprecá-los/rascunhá-los
  manualmente depois. Documentar no CHANGELOG como nota de migração, não deixar o operador descobrir.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|---|
| T1.1 | 0 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 1 | 1 | 1 | 1 |
| T3.1 | 1 | 0 | 0 | 1 | 0 |
| T3.2 | 0 | 1 | 1 | 0 | 0 |
| T4.1 | 1 | 0 | 1 | 0 | 0 |
| T5.1 | 0 | 1 | 0 | 1 | 0 |

**Coverage check:** T1.1, T1.2, T4.1 e T5.1 têm caso EDGE e NEGATIVE considerados; T2.1 e T3.1 tocam
banco e ganharam ambos; T3.2 é ele próprio o caso negativo do milestone.

**Verdict:** PLAN NEEDS ADJUSTMENT — três correções, nenhuma expande escopo.
