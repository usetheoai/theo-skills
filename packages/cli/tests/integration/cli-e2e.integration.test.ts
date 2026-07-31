import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretlintScanner, createYauzlPayloadValidator } from '@usetheo/skills/validators';
import { startTestRegistry, type TestRegistry } from '@usetheo/skills-api/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runPublish } from '../../src/commands/publish.js';
import { runValidate } from '../../src/commands/validate.js';

const PG_URI = process.env['THEOSKILL_PG_URI'] ?? '';
const describeIt = PG_URI !== '' ? describe : describe.skip;

const validation = { payloadValidator: createYauzlPayloadValidator(), secretScanner: createSecretlintScanner() };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describeIt('M5 CLI E2E: validate → publish → retrieve (T4.1)', () => {
  let reg: TestRegistry;
  let dir: string;

  beforeAll(async () => {
    reg = await startTestRegistry(PG_URI);
  });
  beforeEach(async () => {
    await reg.truncate();
    dir = await mkdtemp(join(tmpdir(), 'theoskill-'));
    await writeFile(
      join(dir, 'SKILL.md'),
      `---\nname: pdf-tool\ndescription: summarizes pdf documents\n---\n# pdf-tool\n\nsummarizes pdf documents\n`,
    );
  });
  afterAll(async () => {
    await reg.stop();
  });

  it('validates a local skill dir, publishes it, and the skill is retrievable', async () => {
    const lines: string[] = [];
    const out = (l: string): void => {
      lines.push(l);
    };

    // 1. validate
    expect(await runValidate(dir, { validation, out })).toBe(0);

    // 2. publish (create)
    const code = await runPublish(
      { command: 'publish', path: dir, registry: 'http://local', skillId: 'pdf-tool' },
      { validation, out, fetch: reg.fetch },
    );
    expect(code, lines.join('\n')).toBe(0);
    const opId = lines.join('\n').match(/operation (op_\w+)/)?.[1];
    expect(opId).toBeDefined();

    // 3. wait for the create operation to complete, then retrieve
    let state = 'CREATING';
    for (let i = 0; i < 200 && state !== 'ACTIVE' && state !== 'FAILED'; i++) {
      state = ((await (await reg.fetch(`http://local/v1/operations/${opId}`)).json()) as { state: string }).state;
      if (state === 'CREATING' || state === 'UPDATING') await sleep(50);
    }
    expect(state).toBe('ACTIVE');

    const skill = await reg.fetch('http://local/v1/skills/pdf-tool');
    expect(skill.status).toBe(200);
    expect((await skill.json()) as { skill_id: string }).toMatchObject({ skill_id: 'pdf-tool' });

    await rm(dir, { recursive: true, force: true });
  });

  it('publishing an UPDATE creates a second revision', async () => {
    const out = (): void => undefined;
    await runPublish({ command: 'publish', path: dir, registry: 'http://local', skillId: 'pdf-tool' }, { validation, out, fetch: reg.fetch });
    // wait for the create to complete — fail loudly if it never does
    let createStatus = 0;
    for (let i = 0; i < 200 && createStatus !== 200; i++) {
      createStatus = (await reg.fetch('http://local/v1/skills/pdf-tool')).status;
      if (createStatus !== 200) await sleep(50);
    }
    expect(createStatus).toBe(200);

    // second publish → PATCH (update)
    await writeFile(join(dir, 'SKILL.md'), `---\nname: pdf-tool\ndescription: summarizes and condenses pdf documents v2\n---\n# pdf-tool\n\nv2 body\n`);
    const lines: string[] = [];
    const code = await runPublish(
      { command: 'publish', path: dir, registry: 'http://local', skillId: 'pdf-tool' },
      { validation, out: (l) => lines.push(l), fetch: reg.fetch },
    );
    expect(code, lines.join('\n')).toBe(0);
    expect(lines.join('\n')).toMatch(/updated/);

    // verify a SECOND revision actually exists in the registry (not just the CLI message)
    let count = 0;
    for (let i = 0; i < 200 && count < 2; i++) {
      const r = (await (await reg.fetch('http://local/v1/skills/pdf-tool/revisions')).json()) as { revisions: unknown[] };
      count = r.revisions.length;
      if (count < 2) await sleep(50);
    }
    expect(count).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });
});
