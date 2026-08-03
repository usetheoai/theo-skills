import { describe, expect, it } from 'vitest';

import { type SkillValidationFail, validateSkillPayload } from './skill-validation.js';

/**
 * T1a do M30 — o `field`/`line` do frontmatter tem de SOBREVIVER até a fronteira.
 *
 * `parseFrontmatter` passou a produzi-los (T1b), mas `skill-validation.ts` os descartava ao
 * mapear o erro: `return { ok:false, code, message }`. Produzir a informação e perdê-la uma
 * camada adiante é o mesmo defeito do M26 no `theo-cloud` — e nenhum teste do produtor pega,
 * porque lá ela existe.
 */
describe('skill-validation: field e line sobrevivem ao mapeamento (M30 T1a)', () => {
  it('erro de frontmatter chega com field e line, não só code+message', async () => {
    const md = '---\ndescription: sem nome\n---\n\n# Corpo\n';
    const r = (await validateSkillPayload(Buffer.from('x'), {
      payloadValidator: {
        validate: () => Promise.resolve({ files: [{ path: 'SKILL.md', content: md }], skillMd: md } as never),
      },
      secretScanner: { scan: () => Promise.resolve([]) },
    })) as SkillValidationFail;

    expect(r.ok).toBe(false);
    expect(r.code).toBe('schema_invalid');
    expect(r.field, 'o field morreu no mapeamento — existia no parseFrontmatter').toBe('name');
  });
});
