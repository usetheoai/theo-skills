---
milestone_id: M7
data: 2026-08-03
fase: cycle-release (parcial)
---

# Primeira publicação npm — 3 de 4 pacotes

## Publicado e verificado no registry

| pacote | versão | `npm view` |
|---|---|---|
| `@usetheo/skills` | 0.1.0 | **0.1.0** |
| `@usetheo/skills-sdk` | 0.1.0 | **0.1.0** |
| `@usetheo/skills-mcp` | 0.1.0 | **0.1.0** |
| `@usetheo/skills-cli` | 0.1.0 | **0.1.0** — publicado APÓS a correção (ver abaixo) |

Ordem respeitada: `skills` (sem deps internas) → `sdk`/`mcp` (dependem dele). `pnpm publish`
converte `workspace:*` → `0.1.0`; verificado no tarball ANTES de publicar.

## O bloqueio do CLI — encontrado, corrigido, e então publicado

`packages/cli/package.json` declara, em `dependencies`:

```
"@usetheo/skills-api": "workspace:*"
```

e `packages/api/package.json` tem **`private: true`** — nunca irá ao registry. Medido no tarball
real (`pnpm pack`), o CLI publicaria `"@usetheo/skills-api": "0.0.0"`, e
`npm i @usetheo/skills-cli` quebraria com `E404`, **permanentemente**: versão publicada não se
retira, só se deprecia, e o nome fica queimado.

Não publiquei naquele momento. A autorização era para publicar, não para publicar quebrado.

**Corrigido em `bb00847`, e a causa era mais simples que as três opções listadas abaixo:** o uso de
`@usetheo/skills-api` é **exclusivamente de teste** — dois arquivos importam
`@usetheo/skills-api/testkit`, e há **zero** ocorrências em `src/` e no `dist/`. Estava em
`dependencies` por engano. Movido para `devDependencies`: uma linha, sem bundling e sem tornar a
API pública.

**Publicado depois da correção, e verificado como usuário:** `npm i @usetheo/skills-cli` em projeto
novo fora do repositório instala limpo, resolvendo de
`…/ac-cli/node_modules/@usetheo/skills-cli/package.json`. A correção era real, e o defeito que ela
evitou também — publicado antes, o `E404` seria permanente.

**Correção necessária antes de publicar o CLI** (não aplicada — é mudança de arquitetura de
empacotamento, não de roadmap):

1. tornar `@usetheo/skills-api` publicável, **ou**
2. mover o que o CLI usa da API para `@usetheo/skills` (core, já publicado), **ou**
3. empacotar (bundle) a dependência no build do CLI.

## AC3 da DoD — PASSOU, com evidência

Projeto novo em diretório temporário FORA do repositório:
`npm init -y && npm i @usetheo/skills-sdk`, seguido de
`import { createRemoteSkillsManager } from '@usetheo/skills-sdk'`.

Resolveu de `…/ac3/node_modules/@usetheo/skills-sdk/dist/index.js` — o pacote publicado, não o
`dist/` local. É a asserção que discrimina: contra o `dist/` local o teste passaria sem nada estar
publicado.

## Ainda abertos

- **AC4** — `retrieve` semântico contra o registry no ar, com `usedFallback === false`.
- **AC5** — degradação: registry inalcançável → `usedFallback === true` em ≤ 5 s.
- **AC6** — dogfood `running`: ≥3 evidências em ≥3 **datas distintas**, ≥1 `outcome: fail`.
  Nenhum commit encurta.
- **AC7** — Recall@5 ≥ 0.85 sobre consultas de uso real.
