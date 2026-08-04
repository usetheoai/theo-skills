---
slug: skill-upload-zip
verdict: PENDING
target: https://app-dev.usetheo.dev/skills/new
date: 2026-08-04
---

# Upload de skill como árvore de arquivos — registro de aceitação

**Pedido do dono, verbatim:** *"Caso eu queria subir (upload) eu nao consigo? imagina uma skill que
temnha scripts python, bash etc. Precisamos ter essa possibilidade."*

## O que existia antes, medido

| Camada | Estado medido |
|---|---|
| Registro (`theo-skills`) | `POST /v1/skills` aceita `zippedFilesystem` (zip em base64) desde o M12; `DEFAULT_MAX_BODY_BYTES = 35 * 1024 * 1024` |
| CLI (`packages/cli/src/commands/publish.ts`) | publica pela árvore, com `payloadValidator` + `secretScanner` |
| BFF (`theo-cloud/internal/routes/skills_dashboard.go:500-511`) | struct com `SkillID`/`SkillMd` apenas; `io.LimitReader(r.Body, 1<<20)` |
| Tela (`dashboard/src/pages/skills/authoring.tsx`) | um `<textarea>` |

**A assimetria era da superfície, não do contrato.** Publicar uma skill com script era possível há
milestones — mas só por terminal.

## Escopo escolhido, e por quê

Upload de um **`.zip` já montado**, reusando `zippedFilesystem`. Compor arquivos na tela seria um
mini-IDE que ninguém pediu — a escada da parcimônia para no primeiro degrau que resolve a
necessidade (`rules/parsimony-ladder.md`).

## Três defeitos encontrados no caminho

1. **Markdown + zip no mesmo corpo eram ACEITOS (202).** O registro prioriza `skillMd`
   (`handlers/skills.ts:286-289`) e descartaria o zip **em silêncio**: a skill entraria no acervo
   sem os scripts, sem erro algum. Mais um verde afirmando um sucesso que não existe — o padrão
   que este ciclo já pagou oito vezes. Fechado com recusa na fronteira (Regra 8, fail-fast).
2. **Teto de 1 MiB no BFF.** Não produzia recusa clara: o JSON chegava **truncado** ao decoder, que
   errava sintaxe, e a tela dizia *"informe o identificador e o conteúdo"* — culpando o autor por um
   limite nosso, não escrito em lugar nenhum.
3. **Treze mensagens de recusa em português no BFF Go.** Minha afirmação anterior de *"zero
   português na UI"* estava **incompleta**: a varredura cobriu o que a tela renderiza dela mesma e
   nunca olhou Go.

## Discriminância (mutação → reprova → restaura)

| Mutação | Teste que reprovou |
|---|---|
| `maxCorpoAutoria` de volta a `1 << 20` | `TestCreate_zipGrandeNaoEDecapitadoPeloTetoDeCorpo` |
| priorizar markdown em vez de recusar o par | `TestCreate_zipEMarkdownJuntosERecusado` + o de zip grande |

Restaurado, `go test -count=1` verde nos dois pacotes.

## O que a tela declara que NÃO faz

Um zip **não** é validado antes de publicar — `:validate` recebe markdown. A tela diz isso em vez
de calar: o registro confere a estrutura na ingestão e a falha aparece no acompanhamento da
operação. Afirmar "validado" ali seria descrever uma verificação que ninguém fez.

## Evidência de teste

- `go test -count=1 ./internal/routes/ ./internal/skills/` — verde
- `npx vitest run` — 2516 passed / 8 skipped
- `npx playwright test e2e/skills-journey.spec.ts` — 31 passed
- `skill-upload.test.ts` — 10 testes da lógica pura, fora do React

**Flakiness observada, não resolvida:** uma execução da suíte e2e falhou no M26 (que não toca nada
deste trabalho) logo após os 2516 testes vitest, sob carga. Não reproduzida em 8 execuções
seguintes. Registrado por honestidade, não fechado.

## Pendente para o veredito

`verdict: PENDING` até a validação por clique no app-dev: escolher um `.zip` real de uma skill com
script Python, publicar, e ver a operação chegar a `ACTIVE` com os arquivos no acervo. Enquanto
isso não acontecer, isto é código que passa em teste — não entrega verificada.

- PR: https://github.com/usetheoai/theo-cloud/pull/443
