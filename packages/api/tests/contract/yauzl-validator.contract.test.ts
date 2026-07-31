import { createYauzlPayloadValidator } from '@usetheo/skills/validators';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';


function buildZip(entries: readonly { path: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile();
    for (const e of entries) {
      zip.addBuffer(Buffer.from(e.content, 'utf8'), e.path);
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const SKILL_MD = '---\nname: demo-skill\ndescription: Does a thing. Use when X.\n---\n# Body\n';
const validator = createYauzlPayloadValidator();

describe('yauzl payload validator (real zip)', () => {
  it('validates a clean zip, extracts SKILL.md, files and a sha256 hash', async () => {
    const zip = await buildZip([
      { path: 'SKILL.md', content: SKILL_MD },
      { path: 'scripts/run.sh', content: 'echo hi\n' },
    ]);
    const res = await validator.validate(zip);
    expect(res.skillMd).toContain('name: demo-skill');
    expect(res.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.entryCount).toBe(2);
    expect(res.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'scripts/run.sh']);
  });

  it('rejects a zip without a root SKILL.md', async () => {
    const zip = await buildZip([{ path: 'readme.md', content: 'hi' }]);
    await expect(validator.validate(zip)).rejects.toMatchObject({ code: 'missing_skill_md' });
  });

  it('rejects a non-zip buffer', async () => {
    await expect(validator.validate(Buffer.from('not a zip'))).rejects.toMatchObject({
      code: 'invalid_zip',
    });
  });

  it('content hash equals across identical archives (deterministic sha256)', async () => {
    const a = await buildZip([{ path: 'SKILL.md', content: SKILL_MD }]);
    const r1 = await validator.validate(a);
    const r2 = await validator.validate(a);
    expect(r1.contentHash).toBe(r2.contentHash);
  });
});
