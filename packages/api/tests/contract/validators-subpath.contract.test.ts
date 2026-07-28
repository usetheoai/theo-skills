import { validateSkillPayload } from '@usetheo/skills';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';

import { createSecretlintScanner, createYauzlPayloadValidator } from '../../src/validators.js';

function zip(content: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    z.addBuffer(Buffer.from(content, 'utf8'), 'SKILL.md');
    z.end();
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

describe('api/validators subpath — same adapters as the server boundary', () => {
  const deps = { payloadValidator: createYauzlPayloadValidator(), secretScanner: createSecretlintScanner() };

  it('exposes factories that drive validateSkillPayload to a pass', async () => {
    const buf = await zip(`---\nname: my-skill\ndescription: a useful skill\n---\n# my-skill\n`);
    const r = await validateSkillPayload(buf, deps);
    expect(r.ok).toBe(true);
  });

  it('rejects an invalid frontmatter via the same adapters', async () => {
    const buf = await zip(`---\nname: Invalid Name\ndescription: x\n---\n# x\n`);
    const r = await validateSkillPayload(buf, deps);
    expect(r).toMatchObject({ ok: false, code: 'schema_invalid' });
  });
});
