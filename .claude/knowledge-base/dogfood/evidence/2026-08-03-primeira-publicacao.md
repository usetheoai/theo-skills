---
scenario: theokit-remote-provider
date: 2026-08-03
operator: claude-code (sessão theo-skills)
outcome: partial
summary: Pacotes publicados e consumidos de fora do repo; o CLI teria ido quebrado e foi pego antes.
---

# Primeira publicação, e o defeito que ela revelou

## O que foi exercitado

`@usetheo/skills`, `-sdk`, `-mcp`, `-cli` @ 0.1.0 publicados no npm. Em projeto novo **fora do
repositório**: `npm i @usetheo/skills-sdk`, import de `createRemoteSkillsManager`, resolvido de
`…/ac3/node_modules/@usetheo/skills-sdk/dist/index.js` — o pacote publicado, não o `dist/` local.

Degradação exercitada: com o cliente lançando `ECONNREFUSED`, o `resolve()` devolveu o
`localFallback` em 0 ms com `isDegraded() === true`.

Forma do `toTheokit` medida contra o `@theokit/sdk` **4.37.0** real: as três chaves exigidas
presentes, todas string não-vazia.

## O que FALHOU (por isso `partial`)

`@usetheo/skills-cli` declarava `@usetheo/skills-api` — pacote **`private: true`** — em
`dependencies`. Medido no tarball com `pnpm pack`: publicaria `skills-api@0.0.0`, e
`npm i @usetheo/skills-cli` quebraria com `E404` **permanentemente**, porque versão publicada não
se retira.

Só apareceu ao tentar **entregar de verdade**. Nenhuma suíte pegaria: dentro do monorepo o
`workspace:*` resolve, e o defeito só existe fora dele.

Corrigido antes de publicar (`bb00847`): o uso era exclusivamente de teste (`/testkit`), zero
ocorrências em `src/` e no `dist/` — a dependência foi para `devDependencies`. Publicado depois e
verificado: `npm i @usetheo/skills-cli` instala limpo.

## O que NÃO foi exercitado

Descoberta por intenção contra o registry no ar. O serviço responde (`401` em
`app-dev.usetheo.dev`), mas exige chave `skills:read` por inquilino, cunhada por rota que pede
credencial de admin ausente do ambiente. **Pedida ao dono; não cunhada por conta própria.**

Sem essa metade, a âncora não está completa — daí `partial`, e não `pass`.
