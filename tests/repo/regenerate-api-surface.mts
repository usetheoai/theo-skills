/**
 * Regenerate the public-API snapshots.
 *
 * Run ONLY when a change to the public surface is intended:
 *   pnpm --filter @usetheo/skills build && npx tsx tests/repo/regenerate-api-surface.mts
 *
 * Regenerating is how a deliberate contract change gets recorded — never how a surprise one
 * gets silenced. The diff it produces is the review artifact.
 */
import { writeFileSync } from 'node:fs';

import { declaredTypes, publicSurface } from './api-surface.js';

const ROOT = process.cwd();

const core = publicSurface(ROOT, 'packages/core/src/index.ts');
const sdk = publicSurface(ROOT, 'packages/sdk/src/index.ts');

writeFileSync('tests/repo/core-api-surface.json', `${JSON.stringify(core, null, 2)}\n`);
writeFileSync('tests/repo/sdk-api-surface.json', `${JSON.stringify(sdk, null, 2)}\n`);
writeFileSync('tests/repo/core-api-surface.dts.snap', declaredTypes(ROOT, 'packages/core/dist'));

process.stdout.write(
  `snapshots updated: core=${String(core.length)} names, sdk=${String(sdk.length)} names, ` +
    `core d.ts tree snapshotted\n`,
);
