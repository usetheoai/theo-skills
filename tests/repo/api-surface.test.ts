/**
 * Public API surface — the guard that makes a rename VISIBLE before it ships.
 *
 * Plan: .claude/knowledge-base/plans/english-only-sweep-plan.md § Phase 1 / T1.3
 *
 * `scripts/check-publish-artifacts.mjs` already refuses a manifest that promises a file the
 * tarball does not carry (#115). Nothing compared the NAMES, so a rename left no trace anywhere
 * in the pipeline — and phase 2 of this plan renames five exported types plus five of their
 * FIELDS.
 *
 * TWO levels, because one does not cover what phase 2 does:
 *
 *   names  — catches a renamed/added/removed export
 *   .d.ts  — catches a renamed FIELD, which leaves the name list byte-identical
 *
 * The second exists because of EC-5: `revisao` -> `revision` inside `EntradaDiagnostico` breaks
 * a consumer's `tsc` and changes no exported name at all. The plan claimed the name snapshot
 * guarded that; it does not.
 *
 * The snapshots committed alongside this file record the state BEFORE the rename — in
 * Portuguese. That is the point: the diff of the phase-2 commit is where the contract change
 * becomes reviewable, name by name and field by field.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declaredTypes, publicSurface, type ExportedSymbol } from './api-surface.js';

const ROOT = process.cwd();

const CORE_BARREL = 'packages/core/src/index.ts';
const SDK_BARREL = 'packages/sdk/src/index.ts';
const CORE_DIST = 'packages/core/dist';
const CORE_DTS = 'packages/core/dist/index.d.ts';

const CORE_SNAPSHOT = 'tests/repo/core-api-surface.json';
const SDK_SNAPSHOT = 'tests/repo/sdk-api-surface.json';
// `.snap`, not `.d.ts`: with the real extension every TS tool treats the fixture as a
// declaration file and lints it as source. It is DATA — the recorded shape of the surface.
const CORE_DTS_SNAPSHOT = 'tests/repo/core-api-surface.dts.snap';

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const readSnapshot = (p: string): ExportedSymbol[] => JSON.parse(read(p)) as ExportedSymbol[];

describe('public API surface — exported names', () => {
  it('core matches the committed snapshot', () => {
    const coreSurface = publicSurface(ROOT, CORE_BARREL);
    const coreSurfaceSnapshot = readSnapshot(CORE_SNAPSHOT);

    expect(coreSurface).toEqual(coreSurfaceSnapshot);
  });

  it('sdk matches the committed snapshot', () => {
    expect(publicSurface(ROOT, SDK_BARREL)).toEqual(readSnapshot(SDK_SNAPSHOT));
  });

  it('no longer publishes a Portuguese name', () => {
    // This test used to anchor the PRE-rename state, asserting the Portuguese names were
    // present. Phase 2 landed and BOTH snapshot levels failed first — that failure was the
    // review prompt, name by name and field by field. The assertion now guards the direction
    // of travel: those names must never come back.
    const names = publicSurface(ROOT, CORE_BARREL).map((s) => s.name);

    expect(names).not.toContain('diagnosticarDescobribilidade');
    expect(names).not.toContain('CandidataVizinha');
    expect(names).toContain('diagnoseDiscoverability');
  });

  it('resolver refuses to guess beyond depth 2 instead of returning a partial list', () => {
    // A silently truncated surface is worse than an error: it would record fewer names than
    // the package actually publishes, and the snapshot would bless a gap.
    expect(() => publicSurface(ROOT, CORE_BARREL, { maxDepth: 0 })).toThrow(/depth/i);
  });
});

describe('public API surface — emitted .d.ts', () => {
  it('dts_snapshot_fails_loudly_when_dist_is_missing: never skipped in silence', () => {
    // The check depends on `pnpm build` having run. Skipping when `dist` is absent would make
    // the guard evaporate exactly when someone forgot to build.
    const present = existsSync(join(ROOT, CORE_DTS));
    expect(
      present,
      `${CORE_DTS} is missing — run \`pnpm --filter @usetheo/skills build\` before this gate`,
    ).toBe(true);
  });

  it('matches the committed snapshot, field by field', () => {
    // EC-5. This is the level that sees `revisao` -> `revision`. The name list above cannot.
    const emittedDts = declaredTypes(ROOT, CORE_DIST);
    const dtsSnapshot = read(CORE_DTS_SNAPSHOT);

    expect(emittedDts).toEqual(dtsSnapshot);
  });

  it('no longer declares a Portuguese FIELD', () => {
    // The proof that the two levels are not redundant, kept as a regression: `revisao` and
    // `temVetor` are MEMBERS, so they never appeared in the name list — only the `.d.ts`
    // level could ever see them change.
    const emittedDts = declaredTypes(ROOT, CORE_DIST);

    expect(emittedDts).not.toContain('revisao');
    expect(emittedDts).not.toContain('temVetor');
    expect(emittedDts).toContain('hasVector');
  });
});
