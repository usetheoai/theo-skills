/**
 * Every migration file is known to the drizzle journal.
 *
 * The migrator does NOT read the directory — it reads `meta/_journal.json` and applies the
 * entries listed there. A `.sql` file with no entry is invisible to it: the boot logs
 * `schema aplicado` and the migration never runs, on every environment, forever.
 *
 * This test exists because that happened. `0015_unique_skill_version.sql` was hand-written
 * instead of generated with `pnpm db:generate`, so no entry was created. The droplet's
 * database was correct only because the migration was applied by hand; any fresh database
 * would silently lack the unique index while reporting a healthy boot.
 *
 * A green signal with no substance is the failure mode this whole repository's gates exist to
 * catch — and nothing was watching the migrator itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = 'packages/core/src/infrastructure/db/migrations';

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

const journal = (): JournalEntry[] =>
  (JSON.parse(readFileSync(join(process.cwd(), DIR, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  }).entries;

const sqlTags = (): string[] =>
  readdirSync(join(process.cwd(), DIR))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();

describe('drizzle migration journal', () => {
  it('knows every .sql file — an unjournalled migration never runs', () => {
    const journalled = journal().map((e) => e.tag).sort();

    expect(journalled).toEqual(sqlTags());
  });

  it('has no entry pointing at a file that does not exist', () => {
    const files = new Set(sqlTags());

    expect(journal().filter((e) => !files.has(e.tag)).map((e) => e.tag)).toEqual([]);
  });

  it('numbers entries contiguously from 0 — a gap reorders the queue', () => {
    expect(journal().map((e) => e.idx)).toEqual(journal().map((_, i) => i));
  });

  it('orders entries by `when`, which is what the migrator follows', () => {
    const whens = journal().map((e) => e.when);

    expect(whens).toEqual([...whens].sort((a, b) => a - b));
  });
});
