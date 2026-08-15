/**
 * Regenerate the public-API snapshots.
 *
 * Run ONLY when a change to the public surface is intended:
 *   pnpm --filter @usetheo/skills build && npx tsx tests/repo/regenerate-api-surface.mts
 *
 * Regenerating is how a deliberate contract change gets recorded — never how a surprise one
 * gets silenced. The diff it produces is the review artifact.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { declaredTypes, publicSurface } from './api-surface.js';

const ROOT = process.cwd();

/** Newest mtime under `dir`, or 0 when the directory does not exist. */
function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

// REFUSE TO SNAPSHOT A STALE BUILD.
//
// The `.d.ts` snapshot describes the COMPILED artifact, not the source tree. Running
// this script before rebuilding records the previous build's declarations, the file
// looks updated, the local suite goes green — and CI, which always compiles from
// scratch, fails on a diff nobody can reproduce locally. Measured on PR #154: two
// rounds burned on exactly this, the second after the failure had already been seen.
//
// A wrong snapshot is worse than no snapshot: it is a contract file asserting a
// contract that is not the one shipping.
const srcNewest = newestMtime(join(ROOT, 'packages/core/src'));
const distNewest = newestMtime(join(ROOT, 'packages/core/dist'));
if (distNewest === 0) {
  process.stderr.write(
    'packages/core/dist does not exist — build before snapshotting:\n' +
      '  pnpm --filter @usetheo/skills build\n',
  );
  process.exit(1);
}
if (srcNewest > distNewest) {
  process.stderr.write(
    'packages/core/src is NEWER than packages/core/dist — the snapshot would record the\n' +
      'previous build. Rebuild first:\n' +
      '  pnpm --filter @usetheo/skills build\n',
  );
  process.exit(1);
}

const core = publicSurface(ROOT, 'packages/core/src/index.ts');
const sdk = publicSurface(ROOT, 'packages/sdk/src/index.ts');

writeFileSync('tests/repo/core-api-surface.json', `${JSON.stringify(core, null, 2)}\n`);
writeFileSync('tests/repo/sdk-api-surface.json', `${JSON.stringify(sdk, null, 2)}\n`);
writeFileSync('tests/repo/core-api-surface.dts.snap', declaredTypes(ROOT, 'packages/core/dist'));

process.stdout.write(
  `snapshots updated: core=${String(core.length)} names, sdk=${String(sdk.length)} names, ` +
    `core d.ts tree snapshotted\n`,
);
