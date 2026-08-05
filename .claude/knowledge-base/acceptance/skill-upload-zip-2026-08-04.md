---
slug: skill-upload-zip
verdict: ACCEPTED_WITH_CAVEATS
target: https://app-dev.usetheo.dev/skills/new
date: 2026-08-04
---

# Upload de skill como árvore de arquivos — registro de aceitação

**Pedido do dono, verbatim:** *"Caso eu queria subir (upload) eu nao consigo? imagina uma skill que
temnha scripts python, bash etc. Precisamos ter essa possibilidade."*

## O que existia antes, medido

| Camada | Estado medido |
|---|---|
| Registro (`theo-skills`) | `POST /v1/skills` aceita `zippedFilesystem` desde o M12; `DEFAULT_MAX_BODY_BYTES = 35 MB` |
| CLI | publica pela árvore, com `payloadValidator` + `secretScanner` |
| BFF (`skills_dashboard.go:500-511`) | struct só com `SkillID`/`SkillMd`; `io.LimitReader(r.Body, 1<<20)` |
| Tela (`authoring.tsx`) | um `<textarea>` |

**A assimetria era da superfície, não do contrato.** Publicar skill com script era possível há
milestones — só por terminal.

## Validação por clique — app-dev, `git_sha=3a809d75`

Confirmado que o alvo é o artefato liberado: `GET /v1/version` → `3a809d759523906f201c70dfc201047790329e14`,
o merge do PR #443.

| # | Critério | Resultado | Evidência |
|---|---|---|---|
| 1 | O caminho é descobrível na tela | **passou** | card `Skill with scripts` visível ao chegar por clique no menu |
| 2 | Arquivo errado é recusado com instrução | **passou** | `SKILL.md` solto → *"is not a .zip. Zip the skill folder — SKILL.md at its root…"* |
| 3 | Zip real com script publica | **passou** | `op_xnlcwlfavn4o3dnewseiutn9` → `ACTIVE` |
| 4 | A árvore chega inteira ao registro | **passou** | a skill entrou como `converter-cotacao` (nome lido do frontmatter **dentro do zip**), `Execution: LOCAL`, e a tela diz *"ships a script"* |
| 5 | Recusa do registro chega à tela com a razão | **passou** | primeiro envio recusado: *"payload contains executable script(s); declare `execution: local` in the frontmatter"* |
| 6 | Segredo no zip é recusado | **passou** | credencial de formato realista → *"secret detected in 1 location(s)"* |

O critério 5 é a prova mais forte de que o zip **não foi truncado nem ignorado**: o registro o abriu,
leu o frontmatter, encontrou `scripts/convert.py`, e recusou por uma regra sobre o conteúdo.

### Falso negativo discriminado, não reportado como falha

A primeira tentativa do critério 6 usou `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` — a chave de
**exemplo da documentação AWS** — e a skill **publicou**. Antes de chamar isso de falha de
segurança, repeti com uma credencial de formato realista gerada aleatoriamente: recusada. O
secretlint tem allowlist para exemplos públicos conhecidos; o scanner funciona. A skill publicada
por engano foi apagada pela tela (`acc-upload-zip-vazada`).

Discriminar antes de acusar é o que separou "scanner quebrado" de "scanner ignora exemplo conhecido,
por desenho".

## Caveats — três defeitos encontrados NA validação, corrigidos no PR #444

Nenhum foi encontrado por teste. Todos apareceram usando a tela.

1. **Painel de publicação preso.** Após publicar, `Publish` ficava desabilitado para sempre e o link
   *"View the skill"* usava o identificador **do campo**, não o publicado — trocar o identificador
   gerava link para skill inexistente ao lado de um "Done" verde da operação anterior.
2. **Rotas em português** (`/skills/nova`, `/skills/catalogo`, `/skills/descoberta`) num produto que
   o dono pediu 100% em inglês. Traduzidas, com redirect das antigas.
3. **Rótulo `"Sucessora (opcional)"`** — escapou da tradução; só aparece depois de rolar o detalhe.

Por isso o veredito é `ACCEPTED_WITH_CAVEATS` e não `ACCEPTED`: a capacidade pedida funciona
ponta a ponta e está provada, mas o caminho tinha defeitos reais que a validação expôs.

## Evidência de teste

- `go test -count=1 ./internal/routes/ ./internal/skills/` — verde
- `npx vitest run` — 2516 passed / 8 skipped
- `npx playwright test e2e/skills-journey.spec.ts` — 35 passed
- Discriminância por mutação em ambos os PRs (teto de corpo, priorização markdown/zip, redirect)

**Flakiness ambiental, observada e não resolvida:** execuções da suíte e2e completa falharam em
conjuntos **diferentes** (`recovery`, `observability`, `M26`), nenhuma em skills, todas passando
isoladas. Conjunto variável indica contenção sob paralelismo local. Registrado, não fechado.

## Revalidação das correções do #444 — app-dev, bundle `index-CyPWDQdZ.js`

As três correções foram exercitadas por clique depois que o dashboard convergiu:

| Correção | Como foi exercitada | Resultado |
|---|---|---|
| Painel de publicação preso | publicar `acc-444-primeira`, trocar o identificador para `acc-444-segunda`, publicar de novo **sem recarregar** | painel some ao trocar; botão reabilita; segunda operação `op_q3h39j6d0m6882vzlh3vgv7v` → `ACTIVE`; cada link aponta para a skill certa |
| Rotas em inglês | abrir `/skills/nova` com cache ignorado | redireciona para `/skills/new`; `Test discovery` aponta para `/skills/discovery` |
| Rótulo traduzido | abrir o detalhe de uma skill | `Successor (optional)` |

Skills de teste removidas do acervo ao final (`acc-444-primeira`, `acc-444-segunda`,
`acc-upload-zip-vazada`).

### Uma correção de rota que esta validação me obrigou a fazer

Durante a espera afirmei que uma mudança só-dashboard **não chegava ao ar**, com base em 49 minutos
sem convergência. Estava errado: convergiu em **~1h44** (publish 22:14:59Z → bundle novo entre
23:03Z e 23:58Z). Retratei no [#320](https://github.com/usetheoai/theo-cloud/issues/320#issuecomment-5185937704).

O achado real, com a natureza correta, é a **latência sem sinal de progresso** — e, separadamente,
que **não existe forma de saber qual build do SPA está no ar**: `/v1/version` responde pelo binário
Go e permanece correto durante toda a janela em que o frontend está velho. Aberto como
[#446](https://github.com/usetheoai/theo-cloud/issues/446), porque é falta de observabilidade do
produto, não do reconciliador — e porque o problema já havia sido notado no #363, que foi fechado
por outro defeito e o levou junto.

## Artefatos vivos

- Skill `acc-upload-zip-cambio` (`converter-cotacao`) permanece no acervo do app-dev como evidência
  da capacidade.
- PRs: [#443](https://github.com/usetheoai/theo-cloud/pull/443) (capacidade),
  [#444](https://github.com/usetheoai/theo-cloud/pull/444) (defeitos que a validação expôs) — ambos
  mergeados, no ar e revalidados por clique.
- Issues: [#320](https://github.com/usetheoai/theo-cloud/issues/320) (latência do rollout, comentado
  com evidência **e retratação**), [#446](https://github.com/usetheoai/theo-cloud/issues/446) (o SPA
  não carimba versão — aberto por este ciclo).
