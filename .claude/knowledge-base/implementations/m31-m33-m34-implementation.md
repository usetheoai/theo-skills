---
slug: m31-m33-m34
target_project: theo-cloud + theo-skills
milestone_id: M31, M33, M34
created_at: 2026-08-04
goal: Fechar os eixos de tela do M31, o catálogo do M33 e o diagnóstico de descobribilidade do M34
---

# M31 · M33 · M34 — as jornadas, o catálogo e o diagnóstico

## O que foi entregue

### M31 — as jornadas completas (4 de 5 critérios de tela)

| Critério | Entrega |
|---|---|
| Descoberta observável | `/skills/descoberta` — score **e** qual perna casou |
| Governança | `DangerZone` para apagar, com **terceiro cliente** (`skills:write`) |
| Escala | paginação real + filtro que declara seu alcance |
| Autoria | `/skills/nova` — validar sem publicar, erro por `field`/`line`, publicar acompanhando |
| Visibilidade | **NÃO entregue** — ver ADR 0004 |

### M33 — catálogo

`/skills/catalogo`. O **terceiro estado vazio** passa a existir: filtro-sem-resultado ≠
acervo-vazio ≠ leitura-falhou. Cards com os slots medidos, chips com `+N` **sem contagem por
faceta**, ordem determinística com o critério declarado na tela.

### M34 — descobribilidade

`POST /v1/skills:discoverability` no `theo-skills` (v0.15.0) + o consumo na tela de autoria.
Nomeia a **causa**, não o número. Gate de **regressão**, não piso absoluto.

## Os quatro defeitos que a validação real encontrou

Nenhum foi pego por teste. Todos por exercitar a interface ou o CI.

### 1. A tela de descoberta lia campos que a API não devolve

O handler responde `results` e `matched: [{leg, rank}]`. Minha projeção lia `skills` e
`matched: string[]` — inferi a forma do `hybrid-retriever.ts`, o módulo **interno**, em vez de
medir a resposta HTTP.

**A fixture e o mock repetiam a mesma suposição.** 9 unitários e 2 e2e verdes sobre um contrato
inexistente. Um mock que confirma a suposição de quem o escreveu não testa integração alguma.

### 2. `mesclarPaginas` nunca removia

Depois de apagar uma skill, o refetch da primeira página era mesclado no acervo acumulado e a
apagada **continuava na tela**. Meus 19/19 locais passavam — o **CI pegou**, porque lá o cache
stale chegava primeiro.

A primeira página agora **substitui**; as seguintes acumulam.

### 3. O gate de lifecycle era inalcançável pelo painel

`requireRole('admin')` resolve o papel na tabela de membros pelo `userId`, e a credencial do broker
carrega `sys_platform_gateway` — usuário sintético, **não-membro de propósito**. Respondia 403 a
todo pedido da tela.

Corrigido com ADR 0003: escopo em vez de papel, porque depreciar é curadoria — mesma família de
promover canal, que é *mais* perigoso e já usa esse eixo.

### 4. Comentei no mock que a ordem de registro importava — e registrei na ordem errada

`:retrieve` ficou depois de `{skillId}`, que o capturava. O e2e reprovou com 0 resultados.

## A decisão que declarei em vez de contornar

A DoD do M31 pede **alterar visibilidade** na tela. Ao implementar, um teste existente reprovou:

```
m14-promotion.integration.test.ts:92
  'MEMBER não promove — curadoria é explícita, não auto-publicação'
```

Aquele teste monta admin e member com o **mesmo escopo** e discrimina por **papel**. A regra
protege exposição **fora** do workspace — diferente de depreciar, que é interno. Trocar o eixo,
como fiz no lifecycle, apagaria a distinção: o painel cunha a mesma credencial para todo usuário,
então todo membro passaria a publicar.

Revertí e escrevi o **ADR 0004**. A tela **não oferece** o controle — um botão que sempre responde
403 é pior que a ausência dele.

O critério fica **parcialmente** cumprido, e a aceitação deve registrar a metade de visibilidade
como `not_exercised`, nunca `passed`.

## Achado operacional revelado pela tela

O catálogo no `app-dev` mostra **2 de 3 skills `SEM VETOR`** — não são descobríveis. É exatamente
o que o M34 diagnostica, e explica por que "converter dólar para real" não achava a skill de
câmbio publicada.

A tela tornou visível um problema que existia e ninguém via.

## Gates medidos

| Gate | Resultado |
|---|---|
| `npm test` (dashboard) | **2488 passed** / 289 arquivos |
| e2e de skills (chromium, serial) | **24/24** |
| `theo-skills` core | 142 passed |
| `theo-skills` api | 166 passed |
| Integração M34 (acervo real) | 6 passed |
| Gate de regressão (unit) | 6 passed |
| CI `theo-cloud#424` | 9/9 |
| CI `theo-skills#143` | todos, incluindo Trivy |

## Atrito com sessões concorrentes, declarado

Outra sessão trabalhou na mesma branch `workspace` durante todo o período:

- **Eu varri trabalho dela** com `git add -A` — 80 linhas de `lens/evaluators` sintaticamente
  incompletas entraram no meu commit e quebraram o CI. Preservei o trabalho, tirei do meu branch,
  devolvi ao working tree.
- **Ela varreu o meu** (`d0a5879`), o inverso. O código está correto; não reescrevi histórico.
- O `e2e-ui` reprovou uma vez por um teste de **promptly** que ela estava corrigindo.

A partir do primeiro incidente passei a usar `git add` com caminhos explícitos.

## O que falta

Re-validar a descoberta no `app-dev` **depois** do deploy do fix (PR #426), e rodar
`/acceptance` para M31, M33 e M34 — com o verdict computado, nunca afirmado.
