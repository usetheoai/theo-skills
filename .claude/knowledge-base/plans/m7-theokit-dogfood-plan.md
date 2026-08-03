---
slug: m7-theokit-dogfood
milestone_id: M7
target_project: theo-skills
created_at: 2026-08-03
goal: Fechar o M7 publicando os pacotes no npm e provando, contra a entrega publicada, que a descoberta remota funciona — e que o uso continuado existe.
generated_by: to-plan
source: discoveries/blueprints/m7-m28-theokit-bridge-discover.md + rules/acceptance-target.txt
---

# Plan: M7 — Integração Theokit (remote skill provider) + dogfood

## Baseline Context (estado medido em 2026-08-03)

| peça | arquivo | estado |
|---|---|---|
| `createRemoteSkillsManager` | `packages/sdk/src/remote-skills-manager.ts` (134 linhas) | **existe**, exportado em `index.ts:3`, coberto por `sdk.contract.test.ts` |
| `toTheokit` | mesmo arquivo | **existe**, provado contra `Skill.create` do `@theokit/sdk` 4.36.0 |
| pacotes públicos | `packages/{sdk,cli,mcp,api}` — 4 com `private=false` | **nenhum no registry** (`npm view` → `E404`) |
| credencial | `~/.npmrc`, escopo de usuário, como `usetheodev` | fora do repo, nunca escrita aqui |
| evidências de dogfood | `.claude/knowledge-base/dogfood/evidence/` | 3 arquivos, **todos de 2026-07-31** — mesma data |

**A consequência que molda este plano:** os dois primeiros critérios da DoD já estão `[x]`. Não há
código de produto a escrever. O que falta é **publicar** e **exercitar contra o publicado** — mais
uma cláusula que só o calendário fecha.

## Goal

Levar o M7 a `ACCEPTED` provando, contra os pacotes **publicados no npm**, que: a descoberta por
intenção responde do registry (não do fallback), a degradação acontece dentro do limite, e o uso
continuado é real — ≥3 evidências em ≥3 datas distintas, com ≥1 falha registrada.

## Coverage Matrix (todo critério aberto → ≥1 tarefa)

| # | Critério da DoD | Tarefa |
|---|---|---|
| AC3 | `npm view @usetheo/skills-sdk version` resolve; projeto externo importa do pacote | T1, T2 |
| AC4 | `retrieve` sem sobreposição léxica devolve ≥1 skill, `usedFallback === false` | T3 |
| AC5 | registry inalcançável → fallback com `usedFallback === true` em ≤5 s | T4 |
| AC6 | dogfood `running`: ≥3 evidências, ≥3 datas distintas, ≥1 `outcome: fail` | T5 |
| AC7 | Recall@5 ≥ 0.85 sobre consultas de **uso real** | T6 |

## Fases

### Fase 1 — publicar (é `cycle-release`, não `implement`)

**T1 — publicar os 4 pacotes.** `pnpm install --frozen-lockfile && pnpm -r build`, depois
`npm publish` por pacote, na ordem de dependência (`core` → `sdk` → `cli`/`mcp`).

> **GATE HUMANO.** Primeira publicação de pacote público é **irreversível na prática**: versão
> publicada não se retira, só se deprecia, e o nome fica tomado. Não disparo sem confirmação
> explícita do dono. Se a credencial falhar, PEÇO — não pulo a fase nem registro `NOT_VALIDATED`
> seguindo como se estivesse pronto (`rules/acceptance-target.txt`).

### Fase 2 — provar contra o publicado

**T2 — consumo externo.** Em diretório temporário FORA deste repo:
`npm init -y && npm i @usetheo/skills-sdk`, importar `createRemoteSkillsManager`, verificar que
resolve. **RED primeiro:** o teste falha hoje com `E404` — é a prova de que ele mede publicação, e
não o `dist/` local.

**T3 — descoberta semântica contra o registry no ar.** Consulta **sem sobreposição léxica** com o
nome da skill alvo (o dataset de `semantic_cases` já tem cinco construídas assim). Asserção dupla:
`resultados.length >= 1` **e** `usedFallback === false`. A segunda metade é o que discrimina — sem
ela, o fallback local passaria no teste e ninguém veria.

**T4 — degradação.** Apontar o cliente para host inalcançável; medir. `usedFallback === true` e
tempo ≤5 s. Sem o teto, um retry infinito passaria.

### Fase 3 — o que só o calendário fecha

**T5 — evidências em dias distintos.** Nenhum commit encurta: são ≥3 datas no campo `date:`, e
≥1 com `outcome: fail`. Um dogfood sem falha registrada é teatro.

**T6 — Recall@5 de uso real.** As consultas saem dos registros de T5, não de quem publicou as
skills. Consulta própria contra acervo próprio mede expectativa, não uso.

## Drawbacks & Risks

1. **Publicar é irreversível e o nome fica tomado.** Se o escopo `@usetheo` for compartilhado com
   outro time, um `publish` errado queima o nome. *Mitigação:* gate humano em T1; publicar na ordem
   de dependência; verificar `npm view` entre cada um.
2. **T3 pode passar pelo motivo errado.** Se o embedder de produção estiver com a chave ausente, o
   `retrieve` degrada e o teste vira verde pela perna léxica. *Mitigação:* a asserção
   `usedFallback === false` mais uma consulta de zero sobreposição léxica — ambas necessárias.
3. **AC6 e AC7 não fecham nesta sessão, nem na próxima.** São ≥3 dias. Qualquer plano que prometa
   o M7 "concluído hoje" está mentindo.

## Unresolved Questions

1. **Publicar agora?** Decisão do dono (T1). Bloqueia AC3, AC4, AC5.
2. **De onde vêm as consultas de "uso real" do AC7?** Se o único usuário for a própria equipe, o
   critério fica circular. Pode exigir um consumidor externo — ou revisar o critério, o que é
   mudança de DoD e precisa de decisão explícita, não de conveniência.

## Dependencies

Nenhuma dependência nova. `@theokit/sdk` 4.36.0 já é dev-dependency; publicação usa o `npm` do
ambiente. Sem superfície nova para `deps-audit`.

## Prior Art

- `discoveries/blueprints/m7-m28-theokit-bridge-discover.md` — o estado medido dos três bullets
- `rules/acceptance-target.txt` — a entrega é publicação npm; 4 pacotes; credencial fora do repo
- `rules/dogfood-golden-rule.md` — o contrato de `status: running`
