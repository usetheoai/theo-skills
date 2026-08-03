#!/usr/bin/env node
// Recusa codigo de PRODUCAO que importa pacote nao declarado em `dependencies`.
//
// Existe por uma interrupcao real de 27h: `packages/api/src/server/handlers/skills.ts`
// importava `yazl`, declarado em `devDependencies`. No monorepo funcionava — o `yazl` chega
// hoisted no virtual store, trazido pelo `packages/cli`, que o declara em `dependencies`.
// Na imagem, o estagio `production-deps` roda `pnpm install --prod`: as devDependencies somem,
// o symlink nunca e criado, e o processo morre no boot com ERR_MODULE_NOT_FOUND — mesmo com o
// pacote fisicamente presente em `/app/node_modules/.pnpm/yazl@3.3.1`.
//
// Essa e a assinatura de uma dependencia fantasma: resolve por acidente, atraves de outro
// pacote, e quebra quando o lockfile, a ordem de instalacao ou o escopo do estagio muda. Build
// verde, testes verdes, imagem publicada, servico morto.
//
// IMPORTS DE TIPO SAO IGNORADOS de proposito: `import type ... from 'x'` e apagado na
// compilacao e nao existe em runtime, entao pertence legitimamente a devDependencies. Tratar
// os dois igual produziria falso positivo em `@secretlint/types` (core), que esta correto.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGES_DIR = 'packages'

/** Nome do pacote npm a partir de um specifier: "@scope/x/sub" -> "@scope/x"; "x/sub" -> "x". */
function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, acc)
    // Testes ficam de fora: eles rodam com a arvore de desenvolvimento, onde devDependencies
    // existem. Incluí-los exigiria declarar `vitest` como dependencia de producao.
    else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) acc.push(full)
  }
  return acc
}

/** Specifiers externos importados em runtime (ignora relativos, `node:` e imports de tipo). */
function runtimeImports(file) {
  const text = readFileSync(file, 'utf8')
  const found = new Set()
  // `from '<spec>'` em import/export. O grupo 1 captura um `type` opcional logo apos `import`.
  const re = /^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm
  for (const [, isType, spec] of text.matchAll(re)) {
    if (isType) continue
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    found.add(packageNameOf(spec))
  }
  return found
}

const failures = []
let scanned = 0

for (const name of readdirSync(PACKAGES_DIR)) {
  const dir = join(PACKAGES_DIR, name)
  const manifest = join(dir, 'package.json')
  const src = join(dir, 'src')
  if (!existsSync(manifest) || !existsSync(src) || !statSync(src).isDirectory()) continue

  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const declared = new Set(Object.keys(pkg.dependencies ?? {}))
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}))

  for (const file of sourceFiles(src)) {
    scanned++
    for (const imported of runtimeImports(file)) {
      if (declared.has(imported)) continue
      failures.push({
        pkg: pkg.name,
        file,
        imported,
        onde: dev.has(imported) ? 'esta em devDependencies' : 'nao declarado em lugar nenhum',
      })
    }
  }
}

if (failures.length > 0) {
  console.error('\nFALHA: codigo de producao importa pacote fora de `dependencies`.\n')
  for (const f of failures) {
    console.error(`  ${f.pkg}`)
    console.error(`    ${f.file}`)
    console.error(`      importa "${f.imported}" — ${f.onde}`)
  }
  console.error(
    '\nNo monorepo isto pode funcionar por hoisting, atraves de outro pacote que o declare.',
  )
  console.error('Na imagem de producao o symlink nao existe e o processo morre no boot.\n')
  process.exit(1)
}

console.log(`OK: ${scanned} arquivos de producao, todo import externo declarado em dependencies.`)
