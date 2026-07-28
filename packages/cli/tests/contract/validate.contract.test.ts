import { createSecretlintScanner, createYauzlPayloadValidator } from '@usetheo/skills-api/validators';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';

import { runValidate } from '../../src/commands/validate.js';

const validation = { payloadValidator: createYauzlPayloadValidator(), secretScanner: createSecretlintScanner() };

function zipEntries(entries: readonly { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    for (const e of entries) z.addBuffer(Buffer.from(e.content, 'utf8'), e.name);
    z.end();
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
const zip = (content: string): Promise<Buffer> => zipEntries([{ name: 'SKILL.md', content }]);

function capture(): { out: (l: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { out: (l) => lines.push(l), lines };
}

describe('runValidate', () => {
  it('returns 0 and prints ok for a valid skill', async () => {
    const buf = await zip(`---\nname: my-skill\ndescription: a useful skill\n---\n# my-skill\n`);
    const { out, lines } = capture();
    const code = await runValidate('skill', { validation, out, package: () => Promise.resolve(buf) });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/ok:.*valid skill/);
  });

  it('returns 1 and prints the rule code for an invalid frontmatter', async () => {
    const buf = await zip(`---\nname: Invalid Name\ndescription: x\n---\n# x\n`);
    const { out, lines } = capture();
    const code = await runValidate('skill', { validation, out, package: () => Promise.resolve(buf) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('[schema_invalid]');
  });

  it('returns 1 and prints secret_detected (with a detail line) for a secret-bearing skill', async () => {
    // valid frontmatter, but a config file carries a GitHub token → secret scan (real secretlint) fires
    const buf = await zipEntries([
      { name: 'SKILL.md', content: `---\nname: my-skill\ndescription: a useful skill\n---\n# my-skill\n` },
      { name: 'config.env', content: 'GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwx12\n' },
    ]);
    const { out, lines } = capture();
    const code = await runValidate('skill', { validation, out, package: () => Promise.resolve(buf) });
    expect(code).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('[secret_detected]');
    expect(text).toMatch(/·.*config\.env/); // per-finding detail line printed
  });

  it('returns 2 when no path is given', async () => {
    const { out, lines } = capture();
    expect(await runValidate(undefined, { validation, out })).toBe(2);
    expect(lines.join('\n')).toMatch(/requires a <path>/);
  });

  it('returns 2 on a read/package error', async () => {
    const { out } = capture();
    const code = await runValidate('nope', { validation, out, package: () => Promise.reject(new Error('ENOENT')) });
    expect(code).toBe(2);
  });
});
