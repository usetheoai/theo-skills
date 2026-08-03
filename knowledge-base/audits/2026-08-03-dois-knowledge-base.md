---
data: 2026-08-03
tipo: audit
veredito: falso positivo de caminho + deriva real de run-files
---

# A auditoria de execução mediu o diretório vazio

## O que foi reportado

*"0 implementations, 0 reviews e 0 releases registrados — 27 milestones dados como concluídos
sem quase nenhum artefato de ciclo."*

## O que existe (medido)

Há **DOIS** knowledge-base neste repositório:

| | plans | implementations | reviews | releases | roadmap-runs | adrs |
|---|---|---|---|---|---|---|
| `knowledge-base/` (raiz) | 10 | **6** | **12** | **8** | 8 | 1 |
| `.claude/knowledge-base/` | 6 | 0 | 0 | 0 | 3 | 2 |

A auditoria apontou `--knowledge-base .claude/knowledge-base`. Os artefatos vivem na raiz, e são
substantivos: `m2-lro-governance-webhook-implementation.md` (97 linhas),
`m4-hybrid-retrieve-implementation.md` (83), `m9-close-gaps-review-2026-06-23.md` (65),
`v0.1.0-release.md`, `v0.2.0-release.md`.

**Conclusão (1):** as fases NÃO foram puladas. O `0/0/0` é falso positivo de caminho.

## A deriva que É real

Run-files existem para **11** milestones — M0–M5, M9, M10, M24, M25, M27. Os outros 16 não têm.
Isso é lacuna de rastreabilidade verdadeira. **Nada foi fabricado**: run-file inventado é pior
que ausente.

## M16 (conclusão 2)

`[x]` com M7 `[ ]`, e **ambos corretos**. O bullet do M16 exige o `RemoteSkillsManager`, que
existe (`packages/sdk/src/remote-skills-manager.ts`, 134 linhas, exportado, coberto por
`sdk.contract.test.ts:100`). O M7 segue aberto só pela cláusula de **dogfood** — três evidências
em dias distintos —, não pelo provider. A linha `Dependencies: M12, M7` é mais grossa que a
realidade: o M16 dependia do provider, entregue.

Correção pendente, NÃO aplicada: refinar essa linha. Não a fiz porque hoje já editei o M16 uma
vez com medição errada (reabri afirmando que o manager não existia; desfeito em `d305d3d`), e
uma segunda edição no mesmo dia merece confirmação humana.

## Causa comum dos três (e da minha)

Ler **ausência** onde havia **outro lugar**. A auditoria olhou um diretório; eu li um `grep`
vazio. Regra: ausência só se afirma com o comando dizendo que não achou.

## Recomendação

Decidir qual knowledge-base é canônico — provavelmente `.claude/knowledge-base/`, por
consistência com o kit — e migrar explicitamente. Enquanto os dois coexistirem, toda auditoria
mede um e ignora o outro.
