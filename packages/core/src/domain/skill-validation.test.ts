import { describe, expect, it } from 'vitest';

import { type PayloadValidator, PayloadValidationError, type ValidatedPayload } from './payload-validator.js';
import { type SecretFinding, type SecretScanner } from './secret-scanner.js';
import { validateSkillPayload } from './skill-validation.js';

const VALID_MD = `---\nname: my-skill\ndescription: does a useful thing\n---\n# my-skill\n`;

function validated(skillMd: string): ValidatedPayload {
  return { skillMd, contentHash: 'h', entryCount: 1, files: [{ path: 'SKILL.md', content: skillMd }] };
}

const okValidator = (skillMd: string): PayloadValidator => ({ validate: () => Promise.resolve(validated(skillMd)) });
const throwingValidator = (code: PayloadValidationError['code']): PayloadValidator => ({
  validate: () => Promise.reject(new PayloadValidationError(code, `zip ${code}`)),
});
const noSecrets: SecretScanner = { scan: () => Promise.resolve([]) };
const secretFinding: SecretFinding = { file: 'SKILL.md', type: 'AWSAccessKeyID' };
const findsSecret: SecretScanner = { scan: () => Promise.resolve([secretFinding]) };

describe('validateSkillPayload (shared server+CLI checker)', () => {
  it('returns ok with skill fields for a valid payload', async () => {
    const r = await validateSkillPayload(Buffer.from('z'), { payloadValidator: okValidator(VALID_MD), secretScanner: noSecrets });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.name).toBe('my-skill');
      expect(r.description).toBe('does a useful thing');
    }
  });

  it('reports a zip-safety error with the payload code (no throw)', async () => {
    const r = await validateSkillPayload(Buffer.from('z'), { payloadValidator: throwingValidator('path_traversal'), secretScanner: noSecrets });
    expect(r).toMatchObject({ ok: false, code: 'path_traversal' });
  });

  it('reports a frontmatter error (schema_invalid) for an invalid name', async () => {
    const badMd = `---\nname: Invalid Name\ndescription: x\n---\n# x\n`;
    const r = await validateSkillPayload(Buffer.from('z'), { payloadValidator: okValidator(badMd), secretScanner: noSecrets });
    expect(r).toMatchObject({ ok: false, code: 'schema_invalid' });
  });

  it('reports secret_detected with per-finding details', async () => {
    const r = await validateSkillPayload(Buffer.from('z'), { payloadValidator: okValidator(VALID_MD), secretScanner: findsSecret });
    expect(r).toMatchObject({ ok: false, code: 'secret_detected' });
    if (!r.ok) {
      expect(r.details).toEqual(['SKILL.md: AWSAccessKeyID']);
    }
  });

  it('runs checks in order: zip BEFORE frontmatter (zip error wins)', async () => {
    const r = await validateSkillPayload(Buffer.from('z'), { payloadValidator: throwingValidator('missing_skill_md'), secretScanner: findsSecret });
    expect(r).toMatchObject({ ok: false, code: 'missing_skill_md' }); // not secret/frontmatter
  });

  it('runs checks in order: frontmatter BEFORE secret (frontmatter error wins)', async () => {
    const badMd = `---\nname: Invalid Name\ndescription: x\n---\n# x\n`;
    const r = await validateSkillPayload(Buffer.from('z'), { payloadValidator: okValidator(badMd), secretScanner: findsSecret });
    expect(r).toMatchObject({ ok: false, code: 'schema_invalid' }); // not secret_detected
  });
});

describe('execution × payload (M23) — script não pode se declarar remoto', () => {
  const comArquivos = (skillMd: string, extras: { path: string; content: string }[]): PayloadValidator => ({
    validate: () =>
      Promise.resolve({
        skillMd,
        contentHash: 'h',
        entryCount: 1 + extras.length,
        files: [{ path: 'SKILL.md', content: skillMd }, ...extras],
      }),
  });
  const md = (exec?: string) =>
    `---\nname: my-skill\ndescription: does a useful thing\n${exec !== undefined ? `execution: ${exec}\n` : ''}---\n# corpo\n`;

  it('REJEITA script publicado como remoto', async () => {
    // O agente remoto receberia instruções referenciando um arquivo que ele não tem. A
    // falha não é um erro: é o agente seguindo passos que não existem — plausível, e por
    // isso a pior. A guarda vive aqui, na fronteira de publicação, não no consumo.
    const r = await validateSkillPayload(Buffer.from('z'), {
      payloadValidator: comArquivos(md('remote'), [{ path: 'run.sh', content: '#!/bin/sh\necho oi' }]),
      secretScanner: noSecrets,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('execution_requires_local');
      expect(r.details?.join(' '), 'diz QUAL arquivo forçou a decisão').toContain('run.sh');
    }
  });

  it('o MESMO payload passa declarado como local', async () => {
    const r = await validateSkillPayload(Buffer.from('z'), {
      payloadValidator: comArquivos(md('local'), [{ path: 'run.sh', content: '#!/bin/sh\necho oi' }]),
      secretScanner: noSecrets,
    });
    expect(r.ok, 'declarar `local` é a saída — a guarda não proíbe script, exige honestidade').toBe(true);
  });

  it('detecta script por EXTENSÃO em qualquer profundidade', async () => {
    for (const p of ['scripts/deploy.py', 'a/b/c/tool.js', 'bin/run.ts', 'x.rb', 'x.ps1', 'x.bat']) {
      const r = await validateSkillPayload(Buffer.from('z'), {
        payloadValidator: comArquivos(md(), [{ path: p, content: 'x' }]),
        secretScanner: noSecrets,
      });
      expect(r.ok, `${p} devia exigir execution: local`).toBe(false);
    }
  });

  it('detecta script por SHEBANG, mesmo sem extensão conhecida', async () => {
    // `bin/tool` sem extensão é o caso que uma checagem só por sufixo deixaria passar.
    const r = await validateSkillPayload(Buffer.from('z'), {
      payloadValidator: comArquivos(md(), [{ path: 'bin/tool', content: '#!/usr/bin/env python3\nprint(1)' }]),
      secretScanner: noSecrets,
    });
    expect(r.ok).toBe(false);
  });

  it('markdown e dados NÃO são script — a guarda não pode virar imposto sobre skill normal', async () => {
    const r = await validateSkillPayload(Buffer.from('z'), {
      payloadValidator: comArquivos(md(), [
        { path: 'referencia.md', content: '# notas' },
        { path: 'dados.json', content: '{"a":1}' },
        { path: 'tabela.csv', content: 'a,b' },
      ]),
      secretScanner: noSecrets,
    });
    expect(r.ok).toBe(true);
  });
});
