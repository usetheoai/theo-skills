import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createYauzlPayloadValidator } from '@usetheo/skills-api/validators';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';

import { packageSkill } from '../../src/zip.js';

const validator = createYauzlPayloadValidator();
const SKILL_MD = `---\nname: my-skill\ndescription: a useful skill\n---\n# my-skill\n`;

async function entryPaths(buf: Buffer): Promise<string[]> {
  return (await validator.validate(buf)).files.map((f) => f.path).sort();
}

describe('packageSkill', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zip-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('zips a directory with nested files using posix-relative entry names', async () => {
    await writeFile(join(dir, 'SKILL.md'), SKILL_MD);
    await mkdir(join(dir, 'scripts'));
    await writeFile(join(dir, 'scripts', 'run.sh'), 'echo hi\n');
    const buf = await packageSkill(dir);
    expect(await entryPaths(buf)).toEqual(['SKILL.md', 'scripts/run.sh']);
  });

  it('zips a lone SKILL.md file at its basename', async () => {
    const file = join(dir, 'SKILL.md');
    await writeFile(file, SKILL_MD);
    const buf = await packageSkill(file);
    expect(await entryPaths(buf)).toEqual(['SKILL.md']);
  });

  it('passes a .zip file through unchanged', async () => {
    const zipPath = join(dir, 'skill.zip');
    const original = await new Promise<Buffer>((resolve) => {
      const z = new yazl.ZipFile();
      z.addBuffer(Buffer.from(SKILL_MD), 'SKILL.md');
      z.end();
      const chunks: Buffer[] = [];
      z.outputStream.on('data', (c: Buffer) => chunks.push(c));
      z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    });
    await writeFile(zipPath, original);
    const buf = await packageSkill(zipPath);
    expect(buf.equals(original)).toBe(true);
  });

  it('does NOT package a symlink (no file leak outside the skill dir)', async () => {
    await writeFile(join(dir, 'SKILL.md'), SKILL_MD);
    const secret = join(dir, 'outside-secret.txt');
    await writeFile(secret, 'TOP SECRET');
    // a symlink pointing at the secret — must be skipped by walk()
    await symlink(secret, join(dir, 'link-to-secret'));
    const buf = await packageSkill(dir);
    const paths = await entryPaths(buf);
    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('outside-secret.txt'); // the real file is included
    expect(paths).not.toContain('link-to-secret'); // the symlink is NOT
  });
});
