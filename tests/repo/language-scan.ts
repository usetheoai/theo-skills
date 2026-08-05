/**
 * Language scanner — the units behind the gate in `language-gate.test.ts`.
 *
 * Plan: .claude/knowledge-base/plans/english-only-sweep-plan.md § Phase 0 / T0.1
 *
 * Split from the test file so each unit can be exercised against in-memory fixtures instead of
 * the real tree: a gate that can only be tested by running it on the repository cannot be
 * tested for the cases that matter (a grown budget, an invalid carve-out, an unresolvable base).
 *
 * HONEST LIMIT: detection is heuristic. Portuguese written with no accent AND no function word
 * from the list below is invisible to it. The trade is deliberate — a false positive teaches the
 * team to switch the gate off, and a gate that is off protects nothing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Tier = 'A' | 'B' | 'C' | 'D';
export type ViolationKind = 'export' | 'string' | 'comment' | 'filename' | 'workflow-name' | 'package-description' | 'doc';

export interface Violation {
  readonly tier: Tier;
  readonly kind: ViolationKind;
  readonly path: string;
  /** 1-indexed. `0` when the violation is the path itself, which has no line. */
  readonly line: number;
  readonly excerpt: string;
}

export interface CarveOut {
  readonly path: string;
  readonly tier: Tier;
  readonly reason: string;
  /** ISO date. An unparseable value is REJECTED at parse time, never interpreted. */
  readonly sunset: string;
  readonly issue: string;
}

export interface Budget {
  readonly tierA: number;
  readonly tierB: number;
  readonly tierC: number;
  readonly tierD: number;
  readonly carveOuts: readonly CarveOut[];
}

export interface ScanResult {
  readonly violations: readonly Violation[];
  /** Tracked paths that could not be read. Reported, never a reason to abort the whole scan. */
  readonly skipped: readonly string[];
  /** Always true — the report states its own nature so a green run is not over-read. */
  readonly heuristic: true;
}

/**
 * Portuguese function words and radicals, written WITHOUT accents on purpose.
 *
 * They are matched against folded text, so `não`, `nao` and `NÃO` all reach the same entry.
 * Without this, the matcher would only see ACCENTED Portuguese — and the two files that T6.1
 * renames (`docs/integracao-theokit-mcp.md`, `m28-execution-nao-confiavel...`) carry no accent
 * at all. The gate would report tier D = 0 with both still in place.
 */
const PT_WORDS = [
  'nao', 'sem', 'dos', 'das', 'para', 'com', 'uma', 'que', 'pelo', 'pela',
  'integracao', 'execucao', 'versao', 'configuracao', 'dependencias', 'invariantes',
  'descobrib', 'producao', 'declaradas', 'banco', 'imagem', 'arquivo', 'usuario',
  'obrigatorio', 'obrigatoria', 'invalido', 'invalida', 'encontrada', 'encontrado',
  'erro', 'falhou', 'precisa', 'deve', 'ainda', 'quando', 'porque',
] as const;

/**
 * Subset used on FILE NAMES only.
 *
 * A path is a handful of tokens with no surrounding context, so short ambiguous words
 * (`com`, `sem`, `dos`, `uma`) would fire on English names like `x.com.ts`. Distinctive
 * radicals carry the signal without the noise.
 */
const PT_WORDS_FILENAME = [
  'nao', 'integracao', 'execucao', 'versao', 'configuracao', 'dependencias',
  'descobrib', 'producao', 'confiavel', 'usuario', 'arquivo', 'erro',
] as const;

const ACCENTED = /[À-ſ]/;

/**
 * Portuguese tokens used in IDENTIFIERS, derived from the 429 exported names actually present
 * under `packages/<pkg>/src` (measured 2026-08-05), not guessed.
 *
 * Identifiers are camelCase/PascalCase, so they are split into tokens and matched WHOLE. That
 * matters: the radical `erro` sits inside the English word `Error`, and a substring match
 * flagged 27 English exports (`ClassifiedError`, `SkillsApiError`, …) as Portuguese. Whole-token
 * matching keeps `erro` and drops `error`.
 */
const PT_WORDS_IDENTIFIER = [
  'candidata', 'vizinha', 'vizinhas', 'diagnosticar', 'diagnostico', 'descobribilidade',
  'entrada', 'estado', 'revisao', 'registrar', 'ocioso', 'erro', 'similaridade',
  'publicada', 'existentes', 'chave', 'faltando', 'versoes', 'canais', 'brutos',
  'descricao', 'acervo', 'consulta', 'inquilino', 'escopo', 'maior', 'rival',
] as const;

/** `EstadoDaRevisao` -> ['estado','da','revisao']; `temVetor` -> ['tem','vetor']. */
function splitIdentifier(name: string): string[] {
  return fold(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** An identifier is Portuguese when any of its camelCase tokens is a Portuguese word. */
function isPortugueseIdentifier(name: string): boolean {
  if (ACCENTED.test(name)) return true;
  const tokens = splitIdentifier(name);
  return tokens.some((tok) => PT_WORDS_IDENTIFIER.some((w) => tok === w));
}

/**
 * Roots the sweep does not target.
 *
 * `.claude/` holds the cycle's OWN artifacts — plans, reviews, acceptance evidence. They are
 * written in Portuguese deliberately and are not product surface; renaming an evidence file
 * would also break the acceptance record that cites it. Excluding them is a scope decision,
 * stated here so it is visible rather than buried in a matcher.
 *
 * Everything else the repository tracks IS in scope, including `ROADMAP.md`, `CLAUDE.md` and
 * `CHANGELOG.md`. Leaving them out would pre-judge Unresolved Question Q5; the budget records
 * what IS, and an exclusion has to be an explicit carve-out with a reason and a sunset.
 */
const IGNORED_ROOTS = [
  'node_modules/', 'dist/', 'build/', 'coverage/', '.claude/',
];

/** NFD-decompose, drop combining marks, lowercase. The single normalisation everything shares. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const hasPtWord = (folded: string, words: readonly string[]): boolean =>
  words.some((w) => new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`).test(folded));

/** Text is Portuguese-ish when it carries a diacritic OR a function word from the list. */
function isPortugueseText(raw: string): boolean {
  return ACCENTED.test(raw) || hasPtWord(fold(raw), PT_WORDS);
}

/** File names are judged on distinctive radicals only — see PT_WORDS_FILENAME. */
function isPortugueseFilename(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (ACCENTED.test(base)) return true;
  const tokens = fold(base).split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((t) => PT_WORDS_FILENAME.some((w) => t === w || (w.length > 5 && t.startsWith(w))));
}

// --- per-tier matchers -------------------------------------------------------------------

const isProductionTs = (p: string): boolean =>
  /^packages\/[^/]+\/src\/.*\.ts$/.test(p) && !p.endsWith('.test.ts');

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const EXPORT_NAME = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/;

function scanTierA(path: string, text: string, out: Violation[]): void {
  text.split('\n').forEach((line, i) => {
    const m = EXPORT_NAME.exec(line.trim());
    const name = m?.[1];
    if (name !== undefined && isPortugueseIdentifier(name)) {
      out.push({ tier: 'A', kind: 'export', path, line: i + 1, excerpt: name });
    }
  });
}

function scanTierB(path: string, text: string, out: Violation[]): void {
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const m of line.matchAll(STRING_LITERAL)) {
      const body = m[2] ?? '';
      if (body.length > 3 && isPortugueseText(body)) {
        out.push({ tier: 'B', kind: 'string', path, line: i + 1, excerpt: body.slice(0, 80) });
      }
    }
  });
}

function scanTierC(path: string, text: string, out: Violation[]): void {
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    if (isComment && isPortugueseText(trimmed)) {
      out.push({ tier: 'C', kind: 'comment', path, line: i + 1, excerpt: trimmed.slice(0, 80) });
    }
  });
}

const WORKFLOW_NAME = /^\s*-?\s*name:\s*(.+?)\s*$/;

function scanTierD(path: string, text: string, out: Violation[]): void {
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(path)) {
    text.split('\n').forEach((line, i) => {
      const value = WORKFLOW_NAME.exec(line)?.[1];
      if (value !== undefined && isPortugueseText(value)) {
        out.push({ tier: 'D', kind: 'workflow-name', path, line: i + 1, excerpt: value });
      }
    });
    return;
  }

  if (/^packages\/[^/]+\/package\.json$/.test(path)) {
    text.split('\n').forEach((line, i) => {
      const value = /^\s*"description"\s*:\s*"(.*)"\s*,?\s*$/.exec(line)?.[1];
      if (value !== undefined && isPortugueseText(value)) {
        out.push({ tier: 'D', kind: 'package-description', path, line: i + 1, excerpt: value.slice(0, 80) });
      }
    });
    return;
  }

  // Top-level and docs/ markdown. One violation per document: a 400-line PT README is one
  // piece of work, and 400 rows would drown every other tier in the report.
  if (/^[^/]+\.md$/.test(path) || /^docs\/.*\.md$/.test(path)) {
    const ptLines = text.split('\n').filter((l) => l.trim().length > 0 && isPortugueseText(l)).length;
    if (ptLines > 3) {
      out.push({ tier: 'D', kind: 'doc', path, line: 0, excerpt: `${String(ptLines)} Portuguese lines` });
    }
  }
}

// --- scan --------------------------------------------------------------------------------

export interface ScanOptions {
  readonly files: readonly string[];
  readonly readFile: (path: string) => string;
}

export function scanRepository(opts: ScanOptions): ScanResult {
  const violations: Violation[] = [];
  const skipped: string[] = [];

  for (const path of opts.files) {
    if (IGNORED_ROOTS.some((r) => path.startsWith(r))) continue;

    if (isPortugueseFilename(path)) {
      violations.push({ tier: 'D', kind: 'filename', path, line: 0, excerpt: path });
    }

    let text: string;
    try {
      text = opts.readFile(path);
    } catch {
      // EC-18 — a tracked path with no file on disk (sparse checkout, interrupted `git mv`)
      // is skipped and reported. Aborting the scan over one of them would take the gate down
      // for a reason that has nothing to do with language.
      skipped.push(path);
      continue;
    }

    if (isProductionTs(path)) {
      // Tier A looks at EVERY production file, not just the barrel: `index.ts` only carries
      // `export * from './domain/x.js'`, so the Portuguese names are declared one level down
      // and re-exported from there. Scanning barrels alone reported tierA = 0 while 48
      // occurrences sat in the domain modules — the exact "green over work not done" this
      // gate exists to prevent.
      scanTierA(path, text, violations);
      scanTierB(path, text, violations);
      scanTierC(path, text, violations);
    }
    scanTierD(path, text, violations);
  }

  return { violations, skipped, heuristic: true };
}

export const countByTier = (violations: readonly Violation[], tier: Tier): number =>
  violations.filter((v) => v.tier === tier).length;

// --- carve-outs --------------------------------------------------------------------------

export function parseCarveOut(raw: unknown): CarveOut {
  const c = raw as Partial<CarveOut>;
  const path = c.path ?? '<unnamed>';

  if (Number.isNaN(Date.parse(c.sunset ?? ''))) {
    // EC-4 — every comparison against an Invalid Date is false, INCLUDING `sunset < now`.
    // Interpreted, the entry would read as never-expired forever: one typo, permanent bypass.
    throw new Error(`carve-out ${path}: invalid sunset '${String(c.sunset)}' — expected an ISO date (YYYY-MM-DD)`);
  }
  if ((c.issue ?? '') === '') {
    throw new Error(`carve-out ${path}: missing issue — an exception nobody owns is not an exception`);
  }

  return { path, tier: c.tier ?? 'D', reason: c.reason ?? '', sunset: c.sunset ?? '', issue: c.issue ?? '' };
}

export function loadBudget(path: string, raw: string): Budget {
  let parsed: Partial<Budget>;
  try {
    parsed = JSON.parse(raw) as Partial<Budget>;
  } catch (err) {
    // EC-12 — a bare SyntaxError names neither the file nor the way out.
    throw new Error(
      `${path}: not valid JSON (${err instanceof Error ? err.message : String(err)}). ` +
        `Regenerate it by running the scan and writing the current counts.`,
    );
  }

  return {
    tierA: parsed.tierA ?? 0,
    tierB: parsed.tierB ?? 0,
    tierC: parsed.tierC ?? 0,
    tierD: parsed.tierD ?? 0,
    carveOuts: (parsed.carveOuts ?? []).map(parseCarveOut),
  };
}

// --- the ratchet -------------------------------------------------------------------------

export interface BaseRefOptions {
  readonly mergeBase: () => string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly warn?: (message: string) => void;
}

/**
 * Resolve the commit the ratchet compares against.
 *
 * NEVER `HEAD`. On a `pull_request` event `actions/checkout@v4` checks out the MERGE COMMIT,
 * so `HEAD` already carries the PR's own changes — comparing against it compares the PR with
 * itself, and a budget raised from 131 to 140 and declared as 140 would pass both assertions.
 */
export function resolveBaseRef(opts: BaseRefOptions): string | null {
  const fromGit = opts.mergeBase();
  if (fromGit !== null && fromGit !== '') return fromGit;

  const fromEnv = opts.env['PR_BASE_SHA'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  opts.warn?.(
    'language-gate: base commit unavailable (no origin/develop in history, no PR_BASE_SHA) — ' +
      'ratchet NOT enforced this run. Set fetch-depth: 0 on the checkout to restore it.',
  );
  return null;
}

/** Resolve the merge-base against origin/develop, or null when history is too shallow. */
export function gitMergeBase(cwd: string): string | null {
  try {
    return execFileSync('git', ['merge-base', 'origin/develop', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Every path git tracks — the authoritative file list, not a glob of the working tree.
 *
 * Module-private on purpose: `scanRealRepository` is the only caller, and exporting a symbol
 * with no consumer outside this file is the orphan export the code-quality gate flags.
 */
function gitLsFiles(cwd: string): string[] {
  return execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter((l) => l !== '');
}

/** Scan the real tree. The only function here that touches disk. */
export function scanRealRepository(cwd: string): ScanResult {
  return scanRepository({
    files: gitLsFiles(cwd),
    readFile: (p) => readFileSync(join(cwd, p), 'utf8'),
  });
}

export function gitShowFile(cwd: string, ref: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const TIERS = ['tierA', 'tierB', 'tierC', 'tierD'] as const;

/** A budget breach. `tier` is null for carve-out findings, which are not tier-scoped. */
export interface Finding {
  readonly tier: (typeof TIERS)[number] | null;
  readonly message: string;
}

export interface CompareOptions {
  readonly current: Budget;
  readonly declared: Budget;
  readonly base: Budget | null;
  readonly carveOuts?: readonly CarveOut[];
  /** Injected for tests; defaults to the real clock. */
  readonly now?: Date;
}

export function compareBudget(opts: CompareOptions): Finding[] {
  const findings: Finding[] = [];
  const now = opts.now ?? new Date();

  for (const tier of TIERS) {
    const current = opts.current[tier];
    const declared = opts.declared[tier];
    const base = opts.base?.[tier];

    if (base !== undefined && current > base) {
      findings.push({
        tier,
        message: `${tier} grew from ${String(base)} to ${String(current)} — the language budget may shrink, never grow.`,
      });
      continue;
    }
    if (declared !== current) {
      findings.push({
        tier,
        message:
          `${tier} is ${String(current)} but the budget declares ${String(declared)} — ` +
          `update tests/repo/language-budget.json so the slack cannot hide new violations.`,
      });
    }
  }

  for (const c of opts.carveOuts ?? []) {
    if (Date.parse(c.sunset) < now.getTime()) {
      findings.push({
        tier: null,
        message:
          `carve-out ${c.path} expired on ${c.sunset} (${c.issue}) — it no longer excuses anything; ` +
          `renew it with a new sunset or remove it and fix the finding.`,
      });
    }
  }

  return findings;
}
