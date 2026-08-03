#!/usr/bin/env node
// Recusa publicar um pacote cujo manifesto promete um arquivo que o tarball não tem.
//
// Existe por um defeito real: `sdk` e `mcp` foram publicados em 0.2.0 declarando
// "types": "./dist/index.d.ts" com `declaration: false` no build. O npm não valida
// `types` no publish, então o pacote sobe, instala e importa em JavaScript — e só
// quebra no `tsc` do consumidor, com TS7016. Ver issues #115 e #116.
//
// A lista de arquivos vem de `npm pack --dry-run`, não de existsSync no dist:
// a pergunta é o que chega ao consumidor, e um `files` mal escrito deixa o arquivo
// no disco e fora do pacote. São dois modos de falha distintos e este portão cobre
// ambos ao olhar o artefato em vez da árvore.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, posix } from 'node:path'

const PACKAGES_DIR = 'packages'

/** Caminhos declarados no manifesto que DEVEM existir no tarball. */
function declaredEntryPoints(pkg) {
  const found = []
  const add = (value, field) => {
    if (typeof value === 'string') found.push({ field, path: value })
  }

  add(pkg.types, 'types')
  add(pkg.main, 'main')
  for (const [name, target] of Object.entries(pkg.bin ?? {})) add(target, `bin.${name}`)

  // `exports` aninha condições em profundidade arbitrária ("." -> import -> types).
  const walkExports = (node, trail) => {
    if (typeof node === 'string') return add(node, `exports${trail}`)
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) walkExports(child, `${trail}[${key}]`)
    }
  }
  walkExports(pkg.exports, '')

  return found
}

/** Arquivos que o `npm publish` de fato incluiria, na forma "dist/index.js". */
function packedFiles(dir) {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return new Set(JSON.parse(raw)[0].files.map((f) => f.path))
}

const failures = []
let checked = 0

for (const name of readdirSync(PACKAGES_DIR)) {
  const dir = join(PACKAGES_DIR, name)
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) continue

  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  if (pkg.private === true) continue // nunca vai ao registry

  const packed = packedFiles(dir)
  checked++

  for (const { field, path } of declaredEntryPoints(pkg)) {
    // "./dist/index.d.ts" e "dist/index.d.ts" são o mesmo arquivo no tarball.
    const normalized = posix.normalize(path.replace(/^\.\//, ''))
    if (!packed.has(normalized)) {
      failures.push({ pkg: pkg.name, field, path, normalized })
    }
  }
}

if (failures.length > 0) {
  console.error('\nFALHA: manifesto promete arquivo que o tarball nao entrega.\n')
  for (const f of failures) {
    console.error(`  ${f.pkg}`)
    console.error(`    ${f.field} -> ${f.path}  (ausente como "${f.normalized}")`)
  }
  console.error(
    '\nCausa mais provavel: "declaration": false no tsconfig.build.json de um pacote',
  )
  console.error('que declara "types" no package.json. Ver issues #115 e #116.\n')
  process.exit(1)
}

console.log(`OK: ${checked} pacotes publicaveis, todos os pontos de entrada presentes no tarball.`)
