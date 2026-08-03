# Dogfood manifest — theo-skills

**Slug:** `theokit-remote-provider`
**Status:** `wired`

Contrato em `rules/dogfood-golden-rule.md`. `wired` = a âncora foi invocada ao menos uma vez;
`running` exige uso continuado (≥3 evidências em ≥3 datas distintas, ≥1 `outcome: fail`).

## Por que `wired` e não `running` (2026-08-03)

Os pacotes foram publicados hoje e consumidos de fora do repositório — a âncora foi exercitada.
Uma sessão não é uso continuado, e nenhum commit encurta isso.

## Correção de estado registrada

Este manifesto **não existia** até 2026-08-03, e a regra de dogfood seguia com o template não
editado (`<anchor-slug>`). O texto do M7 no ROADMAP afirmava que ambos tinham sido corrigidos em
2026-08-01 e que três evidências existiam — medido: nenhum arquivo, e nada no histórico git.
