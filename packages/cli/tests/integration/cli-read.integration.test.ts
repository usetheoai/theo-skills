import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretlintScanner, createYauzlPayloadValidator } from '@usetheo/skills/validators';
import { startTestRegistry, type TestRegistry } from '@usetheo/skills-api/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runPublish } from '../../src/commands/publish.js';
import { runRead } from '../../src/commands/read.js';

const PG_URI = process.env['THEOSKILL_PG_URI'] ?? '';
const describeIt = PG_URI !== '' ? describe : describe.skip;

const validation = { payloadValidator: createYauzlPayloadValidator(), secretScanner: createSecretlintScanner() };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describeIt('M9 CLI read commands E2E (T3.3 / gap #5)', () => {
  let reg: TestRegistry;
  let dir: string;

  beforeAll(async () => {
    reg = await startTestRegistry(PG_URI);
  });
  beforeEach(async () => {
    await reg.truncate();
    dir = await mkdtemp(join(tmpdir(), 'theoskill-read-'));
    await writeFile(join(dir, 'SKILL.md'), `---\nname: pdf-tool\ndescription: summarizes pdf documents\n---\n# pdf-tool\n`);
  });
  afterAll(async () => {
    await reg.stop();
  });

  it('get / list / revisions reach the registry and return the published skill', async () => {
    // publish first
    const opLines: string[] = [];
    await runPublish(
      { command: 'publish', path: dir, registry: 'http://local', skillId: 'pdf-tool' },
      { validation, out: (l) => opLines.push(l), fetch: reg.fetch },
    );
    // wait until the skill is retrievable
    let ready = 0;
    for (let i = 0; i < 200 && ready !== 200; i++) {
      ready = (await reg.fetch('http://local/v1/skills/pdf-tool')).status;
      if (ready !== 200) await sleep(50);
    }
    expect(ready).toBe(200);

    const deps = { fetch: reg.fetch, registry: 'http://local' };

    // get
    let lines: string[] = [];
    expect(await runRead({ command: 'get', path: 'pdf-tool' }, { ...deps, out: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('')).toContain('pdf-tool');

    // list
    lines = [];
    expect(await runRead({ command: 'list' }, { ...deps, out: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('')).toContain('pdf-tool');

    // revisions
    lines = [];
    expect(await runRead({ command: 'revisions', path: 'pdf-tool' }, { ...deps, out: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('')).toContain('revisions');

    await rm(dir, { recursive: true, force: true });
  });

  it('get on an unknown skill returns exit 1', async () => {
    const lines: string[] = [];
    const code = await runRead({ command: 'get', path: 'nope' }, { fetch: reg.fetch, registry: 'http://local', out: (l) => lines.push(l) });
    expect(code).toBe(1);
  });
});
