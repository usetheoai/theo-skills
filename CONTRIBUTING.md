# Contribuindo com o theo-skills

## Fluxo de branches

```
workspace ──PR──> develop ──PR + tag semver──> main
 (trabalho)      (integração)                  (release)
```

- Todo trabalho nasce em **`workspace`** — feature, fix, refactor, docs, chore. É uma branch
  única e permanente; não criamos feature branches.
- **`develop`** integra, nunca origina: avança apenas pelo PR de promoção `workspace → develop`.
- **`main`** é release-only: recebe `develop → main` por PR, com tag semver.

Comandos proibidos: `git checkout` (use `git switch` / `git restore`), `git revert` (faça um
commit explícito que reverta), `git push --force` em branch compartilhada, `git reset --hard`
(use `git stash` ou `--soft`).

## Antes de abrir um PR

```bash
pnpm install
pnpm run build          # SEMPRE antes do lint — ver abaixo
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:workflows # invariantes de supply chain dos workflows
```

**A ordem importa.** `build` vem antes de `lint` porque as regras `@typescript-eslint/no-unsafe-*`
são *type-aware*: sem `dist/`, os imports entre pacotes do workspace resolvem para `any` e
disparam erros em código que você não tocou. O `ci.yml` segue a mesma ordem, e um teste a trava.

Integração precisa de banco:

```bash
pnpm run compose:up
pnpm run db:push
pnpm run test:integration
```

## O que o CI exige

| Gate | O que reprova |
|---|---|
| `ci` | lint, typecheck, build ou teste vermelho |
| `integration` | suíte contra Postgres real falhando |
| `security-sast` | achado do semgrep (OWASP) ou segredo detectado pelo gitleaks |
| `actionlint` | erro de sintaxe em workflow ou no shell dos blocos `run:` |
| `test:workflows` | action sem pin por SHA, imagem sem digest, job sem `timeout-minutes` |

**Actions são pinadas por SHA de 40 caracteres, imagens por digest `sha256:`.** Tag é mutável;
SHA não. Trocar `@sha` por `@v4` deixa o CI vermelho, de propósito.

## Testes

- Toda regra de negócio tem teste unitário.
- Todo bug corrigido começa por um **teste de regressão que falha**, depois o fix.
- Testes unitários ficam **ao lado do código** (`<nome>.test.ts`); integração em `tests/integration/`.
- Nome descreve comportamento: `rejeita_skill_id_com_prefixo_reservado`, não `test_validate_1`.

## Changelog

Toda mudança visível ao consumidor entra em `CHANGELOG.md` sob `[Unreleased]`, na categoria
certa (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`), escrita para
quem usa — não para quem escreveu.

## Estilo

Seguimos o **Theo Architecture Standard** (`theo-memory/docs/ARCHITECTURE.md`): pastas e
arquivos em `kebab-case`, tipos em `PascalCase`, funções em `camelCase`, constantes em
`UPPER_SNAKE_CASE`. O núcleo é `contract/` → `domain/` → `infrastructure/`, e a dependência
aponta sempre para dentro: `domain/` nunca importa de `infrastructure/`.

Nunca use `type`, `from`, `delete` ou `id` como nome de parâmetro — prefira `kind`, `source`,
`remove`, `entityId`.

## Segurança

Vulnerabilidade **não** vai para issue pública — veja [SECURITY.md](./SECURITY.md).
