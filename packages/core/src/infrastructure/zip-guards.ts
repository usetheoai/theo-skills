import {
  MAX_COMPRESSION_RATIO,
  MAX_FOLDER_DEPTH,
  MAX_SINGLE_FILE_BYTES,
  MAX_UNCOMPRESSED_TOTAL_BYTES,
  MAX_ZIP_ENTRIES,
  type PayloadErrorCode,
} from '../index.js';

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Pure metadata shape needed to apply the zip-safety guards. */
export interface ZipEntryMeta {
  readonly fileName: string;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly externalFileAttributes: number;
}

export function isSymlink(externalFileAttributes: number): boolean {
  return ((((externalFileAttributes >>> 16) & 0xffff) & S_IFMT) === S_IFLNK);
}

export function isPathUnsafe(name: string): boolean {
  return (
    name.startsWith('/') ||
    name.startsWith('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split(/[\\/]/).includes('..')
  );
}

export function exceedsDepth(name: string): boolean {
  return name.replace(/\/$/, '').split('/').length > MAX_FOLDER_DEPTH;
}

/** Mutable accumulator across entries (dup detection + running totals). */
export interface GuardState {
  entryCount: number;
  totalUncompressed: number;
  readonly seen: Set<string>;
}

export function newGuardState(): GuardState {
  return { entryCount: 0, totalUncompressed: 0, seen: new Set<string>() };
}

/**
 * Apply all safety guards to a single entry given the running state. Returns the
 * violated PayloadErrorCode, or null when the entry is safe. Stateless on the
 * `meta`; mutates `state` (dup set + totals) only when the entry passes. Pure and
 * exhaustively unit-testable WITHOUT a real zip.
 */
export function checkEntry(meta: ZipEntryMeta, isDirectory: boolean, state: GuardState): PayloadErrorCode | null {
  const name = meta.fileName;
  if (isPathUnsafe(name)) {
    return 'path_traversal';
  }
  if (exceedsDepth(name)) {
    return 'too_deep';
  }
  if (isSymlink(meta.externalFileAttributes)) {
    return 'symlink';
  }
  if (state.seen.has(name)) {
    return 'duplicate_entry';
  }
  state.seen.add(name);

  if (isDirectory) {
    return null;
  }

  if (state.entryCount + 1 > MAX_ZIP_ENTRIES) {
    return 'too_many_entries';
  }
  if (meta.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
    return 'file_too_large';
  }
  if (state.totalUncompressed + meta.uncompressedSize > MAX_UNCOMPRESSED_TOTAL_BYTES) {
    return 'total_too_large';
  }
  if (meta.uncompressedSize / Math.max(meta.compressedSize, 1) > MAX_COMPRESSION_RATIO) {
    return 'compression_ratio';
  }

  state.entryCount += 1;
  state.totalUncompressed += meta.uncompressedSize;
  return null;
}
