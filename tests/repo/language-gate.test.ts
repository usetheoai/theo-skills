/**
 * Language gate — the ratchet that stops PT-BR from coming back.
 *
 * Plan: .claude/knowledge-base/plans/english-only-sweep-plan.md § Phase 0 / T0.1
 *
 * Every test here maps to a defect the /code-review or /edge-case-plan found, or to a defect
 * this gate exists to prevent. None is a style preference.
 *
 * The gate is deliberately HEURISTIC and says so in its own output: Portuguese written without
 * accents and without a function word escapes it. That is the accepted trade — a false positive
 * teaches the team to switch the gate off, and a gate that is off protects nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareBudget,
  countByTier,
  fold,
  gitMergeBase,
  gitShowFile,
  loadBudget,
  parseCarveOut,
  resolveBaseRef,
  scanRealRepository,
  scanRepository,
  type Budget,
  type ScanResult,
} from './language-scan.js';

const BUDGET_PATH = 'tests/repo/language-budget.json';

// --- helpers -----------------------------------------------------------------------------

const budget = (over: Partial<Budget> = {}): Budget => ({
  tierA: 0,
  tierB: 0,
  tierC: 0,
  tierD: 0,
  carveOuts: [],
  ...over,
});

/** A scan over an in-memory tree — no disk, no git, deterministic. */
const scanOf = (tree: Record<string, string>, extra: string[] = []): ScanResult =>
  scanRepository({
    files: [...Object.keys(tree), ...extra],
    readFile: (p) => {
      const found = tree[p];
      if (found === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return found;
    },
  });

// --- fold --------------------------------------------------------------------------------

describe('fold', () => {
  it('strips diacritics so unaccented Portuguese is still matchable', () => {
    expect(fold('descobribilidade Não')).toBe('descobribilidade nao');
    expect(fold('INTEGRAÇÃO')).toBe('integracao');
  });
});

// --- tier detection ----------------------------------------------------------------------

describe('tier D — file names', () => {
  it('detector_matches_unaccented_portuguese: counts PT names that carry no accent at all', () => {
    // EC-3. These are the two files T6.1 renames. Neither has a single accent, so an
    // accent-only matcher would report tierD = 0 with both still in place — the gate would
    // declare success over work not done, which is the failure this whole plan exists to end.
    const result = scanOf(
      {},
      ['docs/integracao-theokit-mcp.md', 'packages/api/tests/integration/m28-execution-nao-confiavel.integration.test.ts'],
    );

    const tierDFilenameCount = result.violations.filter((v) => v.tier === 'D' && v.kind === 'filename').length;

    expect(tierDFilenameCount).toBe(2);
  });

  it('leaves English file names alone', () => {
    const result = scanOf({}, ['docs/theokit-mcp-integration.md', 'packages/api/src/server.ts']);
    expect(result.violations.filter((v) => v.kind === 'filename')).toEqual([]);
  });
});

describe('violation shape', () => {
  it('gate_reports_path_and_line: every violation carries where it is, not just a count', () => {
    const result = scanOf({ 'packages/api/src/x.ts': ['const a = 1;', "throw new Error('versao invalida');"].join('\n') });

    const v = result.violations.find((x) => x.tier === 'B');

    expect(v?.path).toBe('packages/api/src/x.ts');
    expect(v?.line).toBe(2);
  });
});

// --- scanner robustness ------------------------------------------------------------------

describe('scanRepository', () => {
  it('gate_skips_missing_file_without_aborting: a tracked path absent from disk is skipped and reported', () => {
    // EC-18. Sparse checkout or an interrupted `git mv` leaves a path in the index with no file.
    // Aborting the whole scan over one of them would take the gate down for an unrelated reason.
    const result = scanOf({ 'packages/api/src/ok.ts': "const s = 'versao';" }, ['packages/api/src/ghost.ts']);

    expect(result.skipped).toEqual(['packages/api/src/ghost.ts']);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('declares its own heuristic nature in the report', () => {
    expect(scanOf({}).heuristic).toBe(true);
  });
});

// --- carve-outs --------------------------------------------------------------------------

describe('parseCarveOut', () => {
  it('carve_out_with_invalid_sunset_is_rejected: an unparseable sunset throws instead of being read', () => {
    // EC-4. `Date.parse('em breve')` is NaN, and every comparison against Invalid Date is false —
    // including `sunset < now`. Interpreted, the carve-out would read as never-expired FOREVER,
    // turning one typo into a permanent, silent bypass of the gate's only exception mechanism.
    expect(() =>
      parseCarveOut({ path: 'packages/api/eval/x.json', tier: 'D', reason: 'r', sunset: 'em breve', issue: '#151' }),
    ).toThrow(/invalid sunset/i);
  });

  it('carve_out_without_issue_is_rejected: an unowned exception is not an exception', () => {
    expect(() =>
      parseCarveOut({ path: 'packages/api/eval/x.json', tier: 'D', reason: 'r', sunset: '2026-11-05', issue: '' }),
    ).toThrow(/issue/i);
  });

  it('accepts a well-formed carve-out', () => {
    const c = parseCarveOut({ path: 'p', tier: 'D', reason: 'r', sunset: '2026-11-05', issue: '#151' });
    expect(c.sunset).toBe('2026-11-05');
  });
});

// --- budget loading ----------------------------------------------------------------------

describe('loadBudget', () => {
  it('gate_fails_clearly_when_budget_is_malformed: names the file and what to do, not SyntaxError', () => {
    // EC-12. A raw `SyntaxError: Unexpected token` tells the reader nothing about which file
    // broke or how to fix it.
    expect(() => loadBudget('tests/repo/language-budget.json', '{ not json')).toThrow(
      /tests\/repo\/language-budget\.json/,
    );
    expect(() => loadBudget('tests/repo/language-budget.json', '{ not json')).toThrow(/regenerat/i);
  });
});

// --- the ratchet -------------------------------------------------------------------------

describe('resolveBaseRef', () => {
  it('ratchet_reads_merge_base_not_head: the base is the merge-base, never HEAD', () => {
    // EC-1. On a `pull_request` event, actions/checkout@v4 checks out the MERGE COMMIT
    // (ci.yml:113, no `ref:`), so HEAD already contains the PR's own changes. Reading the
    // previous budget from HEAD compares the PR against itself: raising tierB 131 -> 140 and
    // declaring 140 would satisfy both assertions. The ratchet would be decorative in the one
    // place it matters.
    const ref = resolveBaseRef({
      mergeBase: () => 'aaaa111',
      env: {},
    });

    expect(ref).toBe('aaaa111');
    expect(ref).not.toBe('HEAD');
  });

  it('falls back to PR_BASE_SHA when merge-base cannot be computed', () => {
    const ref = resolveBaseRef({
      mergeBase: () => null,
      env: { PR_BASE_SHA: 'bbbb222' },
    });
    expect(ref).toBe('bbbb222');
  });

  it('ratchet_skips_loudly_when_base_unresolvable: returns null AND warns', () => {
    // EC-2. `merge-base` needs history, and ci.yml:113 uses the default fetch-depth: 1.
    // Skipping silently would let the run report a comparison it never made.
    const warnings: string[] = [];
    const ref = resolveBaseRef({
      mergeBase: () => null,
      env: {},
      warn: (m) => warnings.push(m),
    });

    expect(ref).toBeNull();
    expect(warnings.join(' ')).toMatch(/ratchet NOT enforced/i);
  });
});

describe('compareBudget', () => {
  it('gate_fails_when_a_tier_grows: debt may shrink, never grow', () => {
    const findings = compareBudget({
      current: budget({ tierB: 131 }),
      declared: budget({ tierB: 131 }),
      base: budget({ tierB: 130 }),
    });

    expect(findings.map((f) => f.tier)).toContain('tierB');
    expect(findings.map((f) => f.message).join(' ')).toMatch(/tierB/);
  });

  it('gate_fails_when_budget_overstates_debt: the budget may not lie upward', () => {
    // Debt shrank to 129 but the file still declares 131. Left alone, the slack becomes room
    // for two new violations to slip in without the ratchet noticing.
    const findings = compareBudget({
      current: budget({ tierB: 129 }),
      declared: budget({ tierB: 131 }),
      base: budget({ tierB: 131 }),
    });

    expect(findings.map((f) => f.message).join(' ')).toMatch(/129/);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/131/);
  });

  it('passes when the budget matches and nothing grew', () => {
    expect(
      compareBudget({
        current: budget({ tierB: 129 }),
        declared: budget({ tierB: 129 }),
        base: budget({ tierB: 131 }),
      }),
    ).toEqual([]);
  });

  it('gate_ignores_expired_carve_out: an expired exception stops excusing anything', () => {
    // Same design as code-quality-golden-rule.md § 4: expired entries are IGNORED, and the
    // finding re-fires at full severity.
    const expired = parseCarveOut({ path: 'p', tier: 'D', reason: 'r', sunset: '2020-01-01', issue: '#1' });
    const live = parseCarveOut({ path: 'p', tier: 'D', reason: 'r', sunset: '2999-01-01', issue: '#1' });

    expect(compareBudget({ current: budget(), declared: budget(), base: null, carveOuts: [expired] }).length)
      .toBeGreaterThan(0);
    expect(compareBudget({ current: budget(), declared: budget(), base: null, carveOuts: [live] })).toEqual([]);
  });

  it('skips the ratchet when there is no base, without claiming it ran', () => {
    expect(
      compareBudget({ current: budget({ tierB: 200 }), declared: budget({ tierB: 200 }), base: null }),
    ).toEqual([]);
  });
});

// --- the gate itself ---------------------------------------------------------------------

describe('language budget (real repository)', () => {
  const ROOT = process.cwd();

  it('matches the declared budget and never grows against the base', () => {
    const scan = scanRealRepository(ROOT);
    const current: Budget = {
      tierA: countByTier(scan.violations, 'A'),
      tierB: countByTier(scan.violations, 'B'),
      tierC: countByTier(scan.violations, 'C'),
      tierD: countByTier(scan.violations, 'D'),
      carveOuts: [],
    };

    const declared = loadBudget(BUDGET_PATH, readFileSync(join(ROOT, BUDGET_PATH), 'utf8'));

    // The base is the merge-base, never HEAD — see resolveBaseRef. When it cannot be resolved
    // the comparison is skipped WITH a warning, never silently declared done.
    const warnings: string[] = [];
    const baseRef = resolveBaseRef({
      mergeBase: () => gitMergeBase(ROOT),
      env: process.env,
      warn: (m) => warnings.push(m),
    });
    const baseRaw = baseRef === null ? null : gitShowFile(ROOT, baseRef, BUDGET_PATH);
    const base = baseRaw === null ? null : loadBudget(`${baseRef ?? 'base'}:${BUDGET_PATH}`, baseRaw);

    const findings = compareBudget({ current, declared, base, carveOuts: declared.carveOuts });

    expect(findings.map((f) => f.message).join('\n')).toBe('');
    expect(scan.heuristic).toBe(true);
  });

  it('reports skipped paths instead of hiding them', () => {
    expect(scanRealRepository(ROOT).skipped).toEqual([]);
  });
});
