/**
 * Regenerate the language-gate ratchet file.
 *
 * Run after any change that moves a tier count:  npx tsx tests/repo/regenerate-budget.mts
 *
 * The budget may only ever SHRINK — the gate refuses a run whose counts grew against the
 * merge-base. Regenerating is how you record progress, never how you make room for more.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { countByTier, scanRealRepository, type Budget } from './language-scan.js';

const PATH = 'tests/repo/language-budget.json';
const scan = scanRealRepository(process.cwd());

const previous = (() => {
  try {
    return JSON.parse(readFileSync(PATH, 'utf8')) as Partial<Budget>;
  } catch {
    return {};
  }
})();

const budget = {
  _note:
    'Language-gate ratchet — every count may SHRINK, never grow. ' +
    'Regenerate with: npx tsx tests/repo/regenerate-budget.mts',
  tierA: countByTier(scan.violations, 'A'),
  tierB: countByTier(scan.violations, 'B'),
  tierC: countByTier(scan.violations, 'C'),
  tierD: countByTier(scan.violations, 'D'),
  carveOuts: previous.carveOuts ?? [],
};

writeFileSync(PATH, `${JSON.stringify(budget, null, 2)}\n`);
process.stdout.write(
  `${PATH} updated: A=${String(budget.tierA)} B=${String(budget.tierB)} ` +
    `C=${String(budget.tierC)} D=${String(budget.tierD)} ` +
    `carveOuts=${String(budget.carveOuts.length)} skipped=${String(scan.skipped.length)}\n`,
);
