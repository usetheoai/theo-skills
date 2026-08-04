# Review: m35-bundles-adoption-surface

**Date:** 2026-08-04
**Reviewer:** agente independente (verificação cética, com medição obrigatória)
**Findings:** 8 (BLOCKER: 1, HIGH: 1, LOW: 1, INFO: 5)
**Verdict inicial:** NEEDS_FIXES
**Verdict após correção (`f50ebab`):** READY_TO_MERGE_WITH_FOLLOWUPS

## BLOCKER

### F1 — O método existia; a porta, não

- **Severidade:** BLOCKER
- **Arquivo:** `packages/api/src/server/handlers/publishing.ts`
- **Referência no plano:** T1.1 (`Files to edit` nomeava a rota explicitamente), Coverage Matrix linha 3
- **Fato medido:** `grep -rn listTokens packages --include="*.ts"` devolvia **zero chamador de
  produção** — só a interface, a implementação e 6 usos em teste. `publishing.ts` tinha `POST`
  (`:147`) e `DELETE` (`:180`) de token, e **nenhum `GET`**.
- **Por que passou:** os nove testes exercitavam o **store**. Nada no eixo de store reprova a
  ausência de uma rota. E o CHANGELOG do commit anterior afirmava que *"a revogação deixou de ser
  impossível"* — declaração falsa: sem listar, a tela continuava sem descobrir o `tokenId` que o
  `DELETE` exige.
- **Correção:** `f50ebab` — rota criada com o mesmo gate `publica` das irmãs, `404` para bundle de
  outro workspace (contrato de não-enumeração do M11), e **teste de endpoint** provado discriminante:
  removida a rota, apenas ele reprova.

**É o quarto caso desta sessão do mesmo padrão** — algo verde afirmando sucesso inexistente. Os
outros três: o teste de regressão do M32 que não discriminava, o achado do CHANGELOG declarado
corrigido e medido aberto, e o override de CVE que não pegou.

## HIGH

### F2 — `total_installs` era emitido em produção e nunca asseverado

- **Arquivo:** `packages/api/src/server/handlers/distribution.ts:237`
- **Fato medido:** `grep -rn total_installs packages --include="*.ts"` → **1 ocorrência**, na
  produção. O único teste do endpoint de adoção (`m27-adoption-behind-auth`) tipa e assere apenas
  `adoption`. O store estava provado; o contrato, não.
- **Correção:** `f50ebab` — dois casos no teste de endpoint, incluindo o zero explícito de janela
  vazia (`0` e `undefined` levam a tela a desenhos opostos).

## LOW — aceito com registro

### F3 — A segunda query é hoje redundante

`adoption()` não tem `.limit()`, logo `sum(rows.installs) === total_installs` sempre. A justificativa
do ADR D2 (paginação/top-N) é **antecipatória**, o que roça YAGNI.

**Mantido, e a decisão é discutível:** o contrato é a fronteira, e a tela não deve depender de uma
invariante interna (`adoption()` devolve tudo) que pode mudar sem aviso. O custo medido é uma ida a
mais ao banco, coberta pelo mesmo índice. Registrado como decisão consciente, não como necessidade
demonstrada.

## INFO — verificações que passaram

| # | Verificação | Resultado medido |
|---|---|---|
| F4 | Índice para as agregações | `install_events_bundle_idx btree (workspace_id, bundle_id, create_time)` — prefixo **idêntico** ao `where` de ambas as consultas. **Sem bottleneck de índice** |
| F5 | DRY entre `totalInstalls` e `countSince` | Perguntas distintas (total do bundle vs do workspace), 2 ocorrências — Regra de 3 não atingida. Extrair seria abstração prematura |
| F6 | Segredo não vaza | Projeção campo a campo omite `tokenHash`; testes comparam a resposta serializada contra o valor cunhado **e** contra o hash lido do banco. Valor cru só na resposta do `POST`, sem log |
| F7 | Isolamento discriminante | Removido `eq(distributionTokens.workspaceId, …)` → reprova em `:101`. Removido `eq(installEvents.workspaceId, …)` de `totalInstalls` → reprova em `:142`. Restaurados; `git diff --exit-code` limpo |
| F8 | Suíte completa | 291 passed / 9 failed em `webhook-delivery`, `trace-propagation`, `m3-embeddings`, `retrieve-latency` — nenhum importa os módulos alterados (verificado por grep) |

## Falha que eu ajudei a causar, e não vou chamar de pré-existente

`integration-gate.contract.test.ts` **passa isolado em 81s** (limite 150s) e falha na suíte
completa. Ele executa a suíte de integração inteira como subprocesso para provar que ela reprova sem
`THEOSKILL_PG_URI` — então **cada arquivo de integração novo aumenta o tempo que ele mede**. Os dois
arquivos deste milestone empurraram o limite.

O gate está correto no que verifica; o desenho (rodar tudo para provar uma coisa) é que não escala.
Issue a filar.

## Quality gates

| Gate | Resultado |
|---|---|
| Integração M35 | **14 passed** (2 suítes) |
| `npm test` (unit) | 445 — core 134, api 166, cli 79, mcp 47, sdk 19 |
| `tsc --noEmit` | 0 erros |
| `eslint` | 0 avisos nos arquivos alterados |
| `/code-quality` | **PASS**, 0 findings, 0 caps |
| `run_validation.py` | **0 FAIL** (5 pass, 4 skip, 1 warn, 1 n/a) |

## Followups

1. `integration-gate.contract.test.ts` não escala — roda a suíte inteira para provar uma asserção.
2. A redundância de `totalInstalls` vs soma das linhas (F3) — revisitar se `adoption()` ganhar `limit`.
3. Herdados do M32 e ainda abertos: `pnpm test` do `packages/api` não roda integração (#132);
   `check_wiring.py` com falso negativo em monorepo (#133).

## Handoff

**READY_TO_MERGE_WITH_FOLLOWUPS** — o BLOCKER está fechado e verificado por teste discriminante; os
followups são registrados e nenhum bloqueia. O critério de tela do M35 permanece fora deste
repositório, como o plano declarou antes de começar.
