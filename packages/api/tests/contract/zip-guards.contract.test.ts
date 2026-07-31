import {
  checkEntry,
  exceedsDepth,
  isPathUnsafe,
  isSymlink,
  newGuardState,
  type ZipEntryMeta,
} from '@usetheo/skills/validators';
import { describe, expect, it } from 'vitest';


const SYMLINK_ATTRS = 0o120755 << 16;
const FILE_ATTRS = 0o100644 << 16;

function meta(over: Partial<ZipEntryMeta> = {}): ZipEntryMeta {
  return {
    fileName: 'a.txt',
    uncompressedSize: 10,
    compressedSize: 10,
    externalFileAttributes: FILE_ATTRS,
    ...over,
  };
}

describe('zip guards (pure)', () => {
  it('isPathUnsafe flags traversal and absolute paths', () => {
    for (const n of ['../x', 'a/../b', '/abs', '\\abs', 'C:\\x', 'foo/../bar']) {
      expect(isPathUnsafe(n), n).toBe(true);
    }
    for (const n of ['SKILL.md', 'scripts/run.sh', 'a/b/c.txt']) {
      expect(isPathUnsafe(n), n).toBe(false);
    }
  });

  it('exceedsDepth flags paths deeper than the max', () => {
    expect(exceedsDepth('a/b/c/d/e/f/g/h/i.txt')).toBe(true); // depth 9
    expect(exceedsDepth('a/b/c.txt')).toBe(false);
  });

  it('isSymlink reads the unix mode from external attributes', () => {
    expect(isSymlink(SYMLINK_ATTRS)).toBe(true);
    expect(isSymlink(FILE_ATTRS)).toBe(false);
  });

  it('checkEntry returns the right code for each violation', () => {
    expect(checkEntry(meta({ fileName: '../e' }), false, newGuardState())).toBe('path_traversal');
    expect(checkEntry(meta({ fileName: 'a/b/c/d/e/f/g/h/i.txt' }), false, newGuardState())).toBe('too_deep');
    expect(checkEntry(meta({ externalFileAttributes: SYMLINK_ATTRS }), false, newGuardState())).toBe('symlink');
    expect(checkEntry(meta({ uncompressedSize: 11 * 1024 * 1024 }), false, newGuardState())).toBe('file_too_large');
    expect(checkEntry(meta({ uncompressedSize: 1000, compressedSize: 1 }), false, newGuardState())).toBe('compression_ratio');
  });

  it('flags too_many_entries past the entry cap', () => {
    const state = newGuardState();
    state.entryCount = 10_000; // MAX_ZIP_ENTRIES
    expect(checkEntry(meta({ fileName: 'one-more.txt' }), false, state)).toBe('too_many_entries');
  });

  it('flags total_too_large past the cumulative size cap', () => {
    const state = newGuardState();
    state.totalUncompressed = 500 * 1024 * 1024; // MAX_UNCOMPRESSED_TOTAL_BYTES
    expect(checkEntry(meta({ fileName: 'big.bin', uncompressedSize: 1024 }), false, state)).toBe('total_too_large');
  });

  it('detects duplicate entries', () => {
    const state = newGuardState();
    expect(checkEntry(meta({ fileName: 'x' }), false, state)).toBeNull();
    expect(checkEntry(meta({ fileName: 'x' }), false, state)).toBe('duplicate_entry');
  });

  it('passes a clean entry and accumulates state', () => {
    const state = newGuardState();
    expect(checkEntry(meta({ fileName: 'SKILL.md', uncompressedSize: 100, compressedSize: 100 }), false, state)).toBeNull();
    expect(state.entryCount).toBe(1);
    expect(state.totalUncompressed).toBe(100);
  });

  it('does not count directories toward entryCount', () => {
    const state = newGuardState();
    expect(checkEntry(meta({ fileName: 'scripts/' }), true, state)).toBeNull();
    expect(state.entryCount).toBe(0);
  });
});
