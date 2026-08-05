# Deps Audit: english-only-sweep

**Date:** 2026-08-05
**Mode:** plan-bound:`english-only-sweep`
**Verdict:** `PASS_WITH_CAVEATS`
**Plan-confidence cap:** 89
**Hard caps triggered:** (none)

## Summary

- **Ecosystems detected:** npm (`package.json` + `pnpm-lock.yaml`). Nenhum `pyproject.toml`, `Cargo.toml` ou `go.mod` no repositório.
- **Deps declaradas pelo plano:** 6 linhas (5 pacotes npm dev + módulos stdlib do Node). **Zero novas** — a escada de parsimônia para na rung 4 para os dois portões e nas rungs 2–3 para a varredura.
- **Vulnerabilidades encontradas no repositório:** 0 CRITICAL, **5 HIGH**, 3 MODERATE, 0 LOW.
- **Vulnerabilidades nas deps que o plano declara:** **0 diretas.** As 5 HIGH são transitivas de desenvolvimento sob duas raízes que o plano usa (`eslint`, `vitest`) — soft warning por § Step 4.4, não hard cap.
- **Allowlist hits:** 0 ativos, 0 expirados (`rules/deps-audit-allowlist.txt` sem entradas aplicáveis).
- **Auditor coverage:** `pnpm audit` ran · `osv-scanner` disponível, **não executado** (ver § Cobertura honesta) · `pip-audit` / `cargo audit` / `govulncheck` **N/A** — nenhum manifesto do ecossistema.

## Vulnerabilities (sorted by severity)

### HIGH — `brace-expansion` (3 advisories, dev-transitivo)

| Advisory | Vulnerável | Corrigido em | Caminhos |
|---|---|---|---|
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | `>=3.0.0 <5.0.7` | `>=5.0.7` | 58 |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | `>=4.0.0 <5.0.8` | `>=5.0.8` | 58 |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | `>=4.0.0 <5.0.9` | `>=5.0.9` | 58 |

- **Path (raiz):** `. > eslint > @eslint/config-array > minimatch > brace-expansion`
- **`dev`:** `true` em todos os findings
- **Diff suggestion:** OMITIDA — não há linha em `package.json` para editar; é resolução transitiva. O caminho é refresh de lockfile (`pnpm update --depth Infinity brace-expansion`), aplicado por humano.
- **Plan reference:** `eslint@^9.0.0` é declarado pelo plano (roda em todo DoD). Transitivo sob dep declarada → **soft warning, cap 89**, não `plan_dep_high_cve`.

### HIGH — `js-yaml` (dev-transitivo)

- [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) — vulnerável `>=4.0.0 <4.3.0`, **corrigido em `>=4.3.0`**
- **Path:** `. > eslint > @eslint/eslintrc > js-yaml` · 16 caminhos · `dev: true`
- **Nota de escopo:** o portão de idioma lê YAML com o pacote **`yaml@^2.9.0`**, que é outro pacote e não está afetado. `js-yaml` entra só por dentro do ESLint.

### HIGH — `postcss` (dev-transitivo)

- [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — vulnerável `<=8.5.17`, **corrigido em `>=8.5.18`**
- **Path:** `. > vitest > @vitest/mocker > vite > postcss` · 8 caminhos · `dev: true`
- **Plan reference:** `vitest@^4.0.0` é declarado pelo plano (os dois portões são testes Vitest). Transitivo sob dep declarada → soft warning.

### MODERATE — `@hono/node-server` (**produção**, fora do escopo do plano)

- [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) — path traversal, **corrigido em `>=2.0.5`**
- **Path:** `packages__mcp > @modelcontextprotocol/sdk > @hono/node-server@1.19.14` · `dev: false`
- **Medição relevante:** a dep **direta** de `packages/api` já está em `^2.0.5`, resolvendo `2.0.12` — corrigida. O que permanece vulnerável é a cópia transitiva `1.19.14` puxada pelo SDK do MCP (`pnpm-lock.yaml:709,715,2881`).
- **Plan reference:** o plano **não declara nem toca** esta dependência. Pré-existente; rastreada na **issue #126**, atualizada hoje com esta medição.

### MODERATE — `postcss` [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) · `esbuild` [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)

Ambos `dev: true`. `postcss` pela mesma raiz `vitest`; `esbuild` por `packages__core > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild` (corrigido em `>=0.24.3`).

## Outdated (non-vulnerable)

Não avaliado nesta execução — `pnpm outdated` não foi rodado. Registrado como lacuna em § Cobertura honesta, não como "nenhum desatualizado".

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `vitest ^4.0.0` | Existing | sim — `package.json` devDeps | sim (direto); 1 HIGH + 1 MODERATE transitivos (`postcss`) | n/a | OK com ressalva |
| `yaml ^2.9.0` | Existing | sim — devDeps | sim | n/a | OK |
| `typescript ^5.4.0` | Existing | sim — devDeps | sim | n/a | OK |
| `eslint ^9.0.0` | Existing | sim — devDeps | sim (direto); 4 HIGH transitivos (`brace-expansion` ×3, `js-yaml`) | n/a | OK com ressalva |
| `typescript-eslint ^8.0.0` | Existing | sim — devDeps | sim | n/a | OK |
| `node:fs` · `node:path` · `node:child_process` | Existing (stdlib) | n/a — runtime | n/a | n/a | OK |
| (nenhuma NEW) | NEW | n/a | n/a | **sim** — três alternativas avaliadas e rejeitadas com motivo (ESLint custom, `@microsoft/api-extractor`, lib de detecção de idioma) | OK |

`## Dependencies` presente, toda versão fixada, coluna Rule 9 preenchida na seção NEW. Nenhum dos hard caps `plan_dependencies_section_missing`, `plan_dep_version_unspecified`, `plan_new_dep_no_rule9_evaluation` ou `plan_dep_not_on_registry` dispara.

## Cobertura honesta — o que este audit NÃO estabeleceu

- **`osv-scanner` não foi executado.** Está instalado (`/home/paulo/go/bin/osv-scanner`), e o contrato da skill recomenda o cruzamento com `pnpm audit` porque as duas bases divergem. Esta execução usou **só** `pnpm audit`. Consequência: um advisory presente em OSV e ausente do GitHub Advisory **não** teria sido visto. O veredito não afirma ausência de CVE — afirma ausência **no que o `pnpm audit` reporta**.
- **`pnpm outdated` não foi executado**, então nada aqui sustenta afirmação sobre versões atrasadas.
- **Explorabilidade não avaliada.** A classificação "dev-only" é sobre **alcance** (fora do tarball publicado), não sobre gravidade intrínseca do CVE.
- **A sugestão de fix dos dev-transitivos é hipótese, não fix verificado** — `pnpm update` não foi rodado (a skill é read-only por contrato).

## Achados registrados

| Issue | Escopo | Estado |
|---|---|---|
| [#151](https://github.com/usetheoai/theo-skills/issues/151) | Os 5 HIGH dev-transitivos (`brace-expansion` ×3, `js-yaml`, `postcss`) — **novo**, não havia registro | aberto hoje |
| [#126](https://github.com/usetheoai/theo-skills/issues/126) | `@hono/node-server` de produção | comentado hoje: o **direto** foi corrigido (`2.0.12`), o **transitivo** sob `@modelcontextprotocol/sdk` (`1.19.14`) permanece |

## Recommended next steps

1. **Não bloqueia este plano.** As 5 HIGH são dev-transitivas sob raízes declaradas; nenhuma alcança artefato publicado. `/plan-confidence` já retornou `SHIPPABLE` (90.4) e o cap 89 deste audit **não** foi aplicado por não haver integração automática (ver § Downstream wiring da SKILL) — a ressalva é honrada por escrito aqui e no `## Dependencies` do plano.
2. Rodar `osv-scanner --lockfile=pnpm-lock.yaml --json` para fechar a lacuna de cobertura antes do `/release` deste plano.
3. Tratar #151 fora deste plano (refresh de lockfile é mudança de dependência, não de idioma — misturar tornaria irrevisável qual mudança causou qual regressão).
4. Prosseguir para `/implement english-only-sweep`.
