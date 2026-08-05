/**
 * Resolve the public surface of a package from its barrel.
 *
 * Plan: .claude/knowledge-base/plans/english-only-sweep-plan.md § Phase 1 / T1.3
 *
 * Reads the SOURCE, not the built `.d.ts`, so the name list is available without a build. The
 * `.d.ts` comparison in the test is the second, deeper level — see the header there.
 *
 * `@microsoft/api-extractor` would do this and much more; it was rejected in ADR D3 because a
 * list of names is what the guard needs, and `fs` plus a regex deliver it without a dependency
 * (parsimony ladder, rung 2).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

export interface ExportedSymbol {
  readonly name: string;
  /** A renamed TYPE breaks a consumer's `tsc` exactly as a renamed VALUE does. Both are here. */
  readonly kind: 'value' | 'type';
}

export interface SurfaceOptions {
  /** How many `export * from` hops to follow. Depth 2 covers the tree measured on 2026-08-05. */
  readonly maxDepth?: number;
}

/** `export { a, type B } from './x.js'` */
const NAMED_REEXPORT = /^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/;
/** `export * from './x.js'` */
const STAR_REEXPORT = /^export\s+\*\s+from\s*['"]([^'"]+)['"]/;
/** `export function foo` / `export type Bar` / `export const baz` */
const DECLARATION = /^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+(\w+)/;

const isTypeKeyword = (kw: string): boolean => kw === 'interface' || kw === 'type';

/** `'./domain/version.js'` relative to `packages/core/src/index.ts` -> `packages/core/src/domain/version.ts` */
function resolveSpecifier(fromFile: string, specifier: string): string {
  return normalize(join(dirname(fromFile), specifier.replace(/\.js$/, '.ts')));
}

function parseNamedClause(clause: string): ExportedSymbol[] {
  return clause
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw !== '')
    .map((raw) => {
      const isType = raw.startsWith('type ');
      const body = isType ? raw.slice('type '.length) : raw;
      // `foo as bar` publishes `bar` — the alias is the name consumers import.
      const name = (body.split(/\s+as\s+/).pop() ?? body).trim();
      return { name, kind: isType ? ('type' as const) : ('value' as const) };
    });
}

function collect(root: string, file: string, depth: number, maxDepth: number, out: ExportedSymbol[]): void {
  if (depth > maxDepth) {
    throw new Error(
      `api-surface: '${file}' re-exports beyond depth ${String(maxDepth)}. ` +
        `Raise maxDepth deliberately — returning a partial surface would let the snapshot bless a gap.`,
    );
  }

  const text = readFileSync(join(root, file), 'utf8');

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    const named = NAMED_REEXPORT.exec(trimmed);
    if (named?.[1] !== undefined) {
      out.push(...parseNamedClause(named[1]));
      continue;
    }

    const star = STAR_REEXPORT.exec(trimmed);
    if (star?.[1] !== undefined) {
      collect(root, resolveSpecifier(file, star[1]), depth + 1, maxDepth, out);
      continue;
    }

    const decl = DECLARATION.exec(trimmed);
    if (decl?.[1] !== undefined && decl[2] !== undefined) {
      out.push({ name: decl[2], kind: isTypeKeyword(decl[1]) ? 'type' : 'value' });
    }
  }
}

/**
 * Every name a package publishes, sorted and de-duplicated.
 *
 * Sorted so that a rename shows up in the diff as one removal and one addition, rather than as
 * a reshuffle nobody can read.
 */
export function publicSurface(root: string, barrel: string, opts: SurfaceOptions = {}): ExportedSymbol[] {
  const collected: ExportedSymbol[] = [];
  collect(root, barrel, 0, opts.maxDepth ?? 2, collected);

  const unique = new Map<string, ExportedSymbol>();
  for (const s of collected) unique.set(`${s.kind}:${s.name}`, s);

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}

/**
 * The declared types of a built package, as one deterministic document.
 *
 * `dist/index.d.ts` alone is NOT enough: it is a barrel of `export ... from`, so a renamed
 * FIELD leaves it byte-identical. The fields are declared one level down
 * (`dist/domain/discoverability.d.ts:56` holds `revisao`), which is why this walks the whole
 * tree. Discovering that mid-task is the reason the field-level test exists at all.
 *
 * Sorted by path so the snapshot is stable across filesystems.
 */
export function declaredTypes(root: string, distDir: string): string {
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.d.ts')) files.push(child);
    }
  };
  walk(distDir);

  return files
    .map((f) => relative(distDir, f).split(sep).join('/'))
    .sort((a, b) => a.localeCompare(b))
    .map((rel) => `// ==== ${rel} ====\n${readFileSync(join(root, distDir, rel), 'utf8')}`)
    .join('\n');
}
