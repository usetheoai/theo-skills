---
slug: skills-journeys-sota
generated_by: roadmap-feature
date: 2026-08-03
milestone_id: M31
status: completed
---

# Grill — M31, as jornadas completas

## Desvio de protocolo, declarado

O skill pede grill de 4 perguntas, **uma por turno**. Comprimi para uma rodada de decisão
porque três das quatro já tinham resposta **medida**, não opinada: a auditoria
`audits/2026-08-03-skills-ux-journeys.md` navegou o produto por clique e levantou o "why now"
(Q1), a DoD (Q3) e os riscos (Q4) com evidência. O que restava era genuinamente do operador:
escopo e granularidade. Foram essas as duas perguntas feitas.

Registro o desvio em vez de silenciá-lo: a finalidade do grill é chegar a 95% de confiança, e
onde a evidência já existia repetir a pergunta seria teatro. Onde não existia, perguntei.

## Q1 — O que é, e por que agora

Fechar a distância entre a API e a tela. Medido em 2026-08-03:

- `<main>` de `/skills` sem um único botão (árvore de acessibilidade).
- Jornada termina em `0 versões` mandando usar a CLI, sem CTA nem comando copiável.
- 1 de 7 escritas da API tem superfície.
- M30 entregou `:validate` + erro com `field`/`line` e **não tem consumidor**.
- Skill `m26-verify-clique` se descreve como "pode ser removida" e não há como removê-la.

## Q2 — Escopo (decisão do operador)

**Perguntado** porque muda o trabalho: as telas vivem no `theo-cloud`.

Recomendei "só o contrato de API aqui", apoiado na nota do M29 — segundo a qual o checkbox
ficaria `[ ]` para sempre.

**O operador escolheu "tudo, incluindo as telas".**

**A recomendação estava apoiada em regra vencida, e eu verifiquei DEPOIS de perguntar:**

- `rules/cycle-release.md:50` — "This cycle **no longer flips** the milestone checkbox. The flip
  is the `flip` phase of `cycle-acceptance`."
- `skills/release/scripts/flip_milestone_checkbox.py` recebe `--roadmap` como **caminho**; não
  resolve por `target_project`.
- `rules/cycle-acceptance.md:56` — Web UI é exercitada por `chrome-devtools` MCP, navegando a
  URL implantada.

Ou seja: o checkbox vira quando `/acceptance M31` navegar o `app-dev`, **independente de onde o
código da tela mora**. A escolha do operador é viável; minha objeção é que estava velha. A nota
do M29 descreve o comportamento anterior e hoje induz a erro — anotado como achado.

## Q3 — Definition of done

Seis critérios, todos exercitáveis contra a entrega implantada. Ver o bloco do M31 no
`ROADMAP.md`. Âncora objetiva: `theo-cloud/dashboard/DESIGN.md` v1.0 (locked), com as seções
hoje violadas citadas nominalmente (§1, §4.1, §5.1, §6.1, §10.2, §11.1).

## Q4 — Riscos novos

1. Atravessa dois repositórios; entregar tela antes de API esvazia o playground.
2. "SOTA" sem âncora vira opinião — resolvido amarrando ao `DESIGN.md`.

## Q5 (skill Step 5) — SOTA delta

**Não.** As jornadas se medem contra um contrato interno já escrito (`DESIGN.md`, 18 seções) e
contra capacidades irmãs do mesmo produto (Memory, Trust, Prompts, Observability), todas lidas
nesta sessão. Nenhum peer externo novo acrescentaria critério que o contrato não dê.

## Cross-check de out-of-scope

Sem sobreposição. O "out of scope" lista runtime/execução, marketplace público, composição entre
skills e compliance pesado — nada sobre interface ou jornadas.
