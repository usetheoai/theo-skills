import { createHash } from 'node:crypto';

import {
  type PayloadErrorCode,
  type PayloadFile,
  PayloadValidationError,
  type PayloadValidator,
  type ValidatedPayload,
} from '@usetheo/skills';
import yauzl, { type Entry } from 'yauzl';

import { checkEntry, newGuardState } from './zip-guards.js';

function validateZip(zip: Buffer): Promise<ValidatedPayload> {
  const contentHash = createHash('sha256').update(zip).digest('hex');

  return new Promise<ValidatedPayload>((resolve, reject) => {
    let settled = false;
    const fail = (code: PayloadErrorCode, message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new PayloadValidationError(code, message));
    };

    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err !== null || zipfile === undefined) {
        fail('invalid_zip', `not a valid zip archive: ${err?.message ?? 'unknown'}`);
        return;
      }

      const state = newGuardState();
      const files: PayloadFile[] = [];
      let hasSkillMd = false;

      zipfile.on('error', (e: Error) => fail('invalid_zip', e.message));

      zipfile.on('entry', (entry: Entry) => {
        const isDir = entry.fileName.endsWith('/');
        const violation = checkEntry(
          {
            fileName: entry.fileName,
            uncompressedSize: entry.uncompressedSize,
            compressedSize: entry.compressedSize,
            externalFileAttributes: entry.externalFileAttributes,
          },
          isDir,
          state,
        );
        if (violation !== null) {
          fail(violation, `${violation}: ${entry.fileName}`);
          return;
        }
        if (isDir) {
          zipfile.readEntry();
          return;
        }
        if (entry.fileName === 'SKILL.md') {
          hasSkillMd = true;
        }

        // All guards passed — safe to decompress this entry.
        zipfile.openReadStream(entry, (rsErr, stream) => {
          if (rsErr !== null || stream === undefined) {
            fail('invalid_zip', `failed to read entry ${entry.fileName}: ${rsErr?.message ?? 'unknown'}`);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', (e: Error) => fail('invalid_zip', e.message));
          stream.on('end', () => {
            files.push({ path: entry.fileName, content: Buffer.concat(chunks).toString('utf8') });
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => {
        if (!hasSkillMd) {
          fail('missing_skill_md', 'SKILL.md not found at the archive root');
          return;
        }
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          skillMd: files.find((f) => f.path === 'SKILL.md')?.content ?? '',
          contentHash,
          entryCount: state.entryCount,
          files,
        });
      });

      zipfile.readEntry();
    });
  });
}

/** yauzl-backed PayloadValidator (zip-bomb safe — guards from metadata first). */
export function createYauzlPayloadValidator(): PayloadValidator {
  return { validate: validateZip };
}
