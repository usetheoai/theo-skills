# Edge Case Review — m31-retrieve-attribution

Date: 2026-08-03
Plano analisado: `.claude/knowledge-base/plans/m31-retrieve-attribution-plan.md`
Tasks analisadas: 4 (1.1, 2.1, 3.1, Fase 4)
Edge cases: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

> Cada premissa foi testada **contra o disco**. Um edge-case review que confere no papel encontra
> zero, e o que ele deixa passar chega ao `plan-confidence` como hard cap — ou pior, ao implement
> como retrabalho.

## MUST FIX

### EC-1: caminho fabricado na Fase 3 — e o hedge era o sintoma

- **Task afetada:** 3.1
- **Família:** Citação
- **Cenário:** o plano listava `packages/core/src/domain/skills-store.ts` em *Files to edit*, com
  a ressalva *"ou o módulo de listagem que a Fase 3 identificar"*. O arquivo **não existe**
  (`test -f` → AUSENTE). O módulo real é `packages/api/src/server/store/skills-store.ts`.
- **Impacto:** hard cap `fabricated_citation` no `plan-confidence` → `INVALID`. E, pior que o
  cap: o implementador começaria a task procurando um arquivo inexistente. **O hedge era o
  defeito** — um plano que não sabe qual arquivo edita não está pronto para implementar; a
  ressalva escondia isso em vez de resolver.
- **Fix aplicado:** caminho corrigido, com LoC medido (387).

## SHOULD TEST

### EC-2: `visibility` é escrito há milestones e nunca lido de volta

- **Task afetada:** 3.1
- **Checkpoint sugerido:** o teste de contrato asserta a **forma** (`visibility` ∈ conjunto
  conhecido), nunca um valor fixo. A coluna é usada num `WHERE` (`skills-store.ts:323`) mas nunca
  projetada — pode haver linha antiga com valor que ninguém previu. Assertar valor fixo faria o
  teste falhar por dado, não por código; assertar forma faz a linha divergente aparecer como
  falha real.

## DOCUMENT

### EC-3: o risco de orçamento era real sobre premissa errada

- **Risco aceito:** o plano registrava `handlers/skills.ts` a 3 LoC do teto de 500 como risco da
  Fase 3. A listagem não vive lá — vive no store, com folga. O risco **se dissolveu**, e foi
  mantido tachado no plano em vez de apagado: quem abrir o arquivo de 497 LoC vai ter a mesma
  dúvida, e o registro responde antes da pergunta.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| 1.1 | 0 | 0 | 0 | 0 |
| 2.1 | 0 | 0 | 0 | 0 |
| 3.1 | 3 | 1 | 1 | 1 |
| Fase 4 | 0 | 0 | 0 | 0 |

**Verdict: PLANO AJUSTADO** — 1 MUST FIX, absorvido. As Fases 1 e 2 passaram sem achado: os
caminhos que citam foram validados (`types.ts`, `hybrid-retriever.test.ts`,
`packages/api/tests/contract/` todos existem) e a análise de dependência bate com o
`grep -rln rrfFuse` do Baseline.

Não inventei risco para encher relatório. Três achados, todos reproduzíveis por comando.
