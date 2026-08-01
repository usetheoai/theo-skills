import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSecretlintScanner, createYauzlPayloadValidator } from '@usetheo/skills/validators';
import { startTestRegistry, type TestRegistry } from '@usetheo/skills-api/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { extractZipTo } from '../../src/commands/extract-zip.js';
import { runInstall } from '../../src/commands/install.js';
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

describeIt('M26 DoD #4 — publicar → INSTALAR → o arquivo executável no runtime alvo', () => {
  let reg: TestRegistry;
  let origem: string;
  let projeto: string;

  beforeAll(async () => {
    reg = await startTestRegistry(PG_URI);
  });
  beforeEach(async () => {
    await reg.truncate();
    origem = await mkdtemp(join(tmpdir(), 'skill-src-'));
    projeto = await mkdtemp(join(tmpdir(), 'agente-'));
    await writeFile(
      join(origem, 'SKILL.md'),
      `---\nname: triagem\ndescription: classifica um chamado por urgencia e roteia\ncategory: Ops\nexecution: local\nversion: "1.0.0"\n---\n# triagem\n\n1. rode ./classificar.sh\n`,
    );
    await writeFile(join(origem, 'classificar.sh'), '#!/bin/sh\necho P1\n');
    await chmod(join(origem, 'classificar.sh'), 0o755);
  });
  afterAll(async () => {
    await reg.stop();
  });

  it('a skill instalada CHEGA no layout do runtime e o script continua EXECUTÁVEL', async () => {
    // O DoD dizia "publicar → instalar → arquivo no diretório que o runtime lê", e o e2e
    // parava no publish. O elo que faltava é justamente onde o defeito estava: o modo do
    // arquivo se perdia entre o empacotador e o extrator, e uma skill `local` — que é
    // definida por ter script — chegava ao agente sem permissão de execução.
    const linhas: string[] = [];
    const out = (l: string): void => {
      linhas.push(l);
    };

    expect(await runValidate(origem, { validation, out })).toBe(0);
    expect(
      await runPublish(
        { command: 'publish', path: origem, registry: 'http://local', skillId: 'triagem' },
        { validation, out, fetch: reg.fetch },
      ),
      linhas.join('\n'),
    ).toBe(0);

    const opId = linhas.join('\n').match(/operation (op_\w+)/)?.[1];
    let state = 'CREATING';
    for (let i = 0; i < 200 && state !== 'ACTIVE' && state !== 'FAILED'; i++) {
      state = ((await (await reg.fetch(`http://local/v1/operations/${opId!}`)).json()) as { state: string }).state;
      if (state === 'CREATING' || state === 'UPDATING') await sleep(50);
    }
    expect(state).toBe('ACTIVE');

    const skillsDir = join(projeto, '.theokit', 'skills');
    expect(
      await runInstall('triagem', {
        out,
        fetch: reg.fetch,
        registry: 'http://local',
        extract: extractZipTo,
        skillsDir,
        runtime: 'theokit',
      }),
      linhas.join('\n'),
    ).toBe(0);

    const script = join(skillsDir, 'triagem', 'classificar.sh');
    const doc = join(skillsDir, 'triagem', 'SKILL.md');
    expect((await readFile(doc, 'utf8')), 'o corpo chegou').toContain('classificar.sh');
    expect((await stat(script)).mode & 0o111, 'o script continua executável').not.toBe(0);
    expect((await stat(doc)).mode & 0o111, 'e o markdown NÃO vira executável').toBe(0);
  }, 60_000);
});

