import { describe, expect, it } from 'vitest';

import { parseFrontmatter, SkillFrontmatterError } from './frontmatter.js';

const FM = (body: string): string => `---\n${body}\n---\n# Body\n`;

describe('parseFrontmatter', () => {
  it('parses name + description and preserves unknown fields', () => {
    const fm = parseFrontmatter(
      FM('name: demo-skill\ndescription: Does a thing. Use when X.\nversion: "1.2.0"\ncategory: data'),
    );
    expect(fm.name).toBe('demo-skill');
    expect(fm.description).toBe('Does a thing. Use when X.');
    expect(fm.fields['version']).toBe('1.2.0');
    expect(fm.fields['category']).toBe('data');
  });

  it('rejects content without frontmatter (missing_frontmatter)', () => {
    expect.assertions(2);
    try {
      parseFrontmatter('# no frontmatter here');
    } catch (err) {
      expect(err).toBeInstanceOf(SkillFrontmatterError);
      expect((err as SkillFrontmatterError).code).toBe('missing_frontmatter');
    }
  });

  it('rejects missing description (schema_invalid)', () => {
    expect(() => parseFrontmatter(FM('name: demo'))).toThrow(SkillFrontmatterError);
    try {
      parseFrontmatter(FM('name: demo'));
    } catch (err) {
      expect((err as SkillFrontmatterError).code).toBe('schema_invalid');
      expect((err as SkillFrontmatterError).message).toMatch(/description/);
    }
  });

  it('rejects missing name', () => {
    expect(() => parseFrontmatter(FM('description: x'))).toThrow(/name/);
  });

  it('rejects invalid name shapes', () => {
    for (const bad of ['Demo', 'demo_skill', '-demo', 'demo-', 'de--mo', 'UPPER']) {
      expect(() => parseFrontmatter(FM(`name: ${bad}\ndescription: ok`)), bad).toThrow(
        SkillFrontmatterError,
      );
    }
  });

  it('rejects name over 64 chars and description over 1024 chars', () => {
    expect(() => parseFrontmatter(FM(`name: ${'a'.repeat(65)}\ndescription: ok`))).toThrow(/64/);
    expect(() =>
      parseFrontmatter(FM(`name: demo\ndescription: ${'x'.repeat(1025)}`)),
    ).toThrow(/1024/);
  });

  it('rejects malformed YAML (schema_invalid)', () => {
    expect.assertions(2);
    try {
      parseFrontmatter('---\nname: "unclosed\n---\n');
    } catch (err) {
      expect(err).toBeInstanceOf(SkillFrontmatterError);
      expect((err as SkillFrontmatterError).code).toBe('schema_invalid');
    }
  });
});

describe('category e execution (M23 — descoberta remota)', () => {
  const md = (extra: string) => `---\nname: demo\ndescription: Faz X. Use quando Y.\n${extra}\n---\n\n# corpo\n`;

  it('category é TEXTO LIVRE — o vocabulário é de quem publica', () => {
    // Lista fechada travaria quem publica numa taxonomia que nós escolhemos hoje e ele
    // descobre errada amanhã. O custo aceito é ruído; o filtro é auxiliar da busca
    // semântica, não substituto dela.
    expect(parseFrontmatter(md('category: Sales')).category).toBe('Sales');
    expect(parseFrontmatter(md('category: Shop')).category).toBe('Shop');
    expect(parseFrontmatter(md('category: Qualquer Coisa Nova')).category).toBe('Qualquer Coisa Nova');
  });

  it('category é OPCIONAL — skill sem categoria continua publicável', () => {
    expect(parseFrontmatter(md('')).category).toBeUndefined();
  });

  it('category não-texto é rejeitada — nunca coagida em silêncio', () => {
    // `category: 42` virando "42" faria o filtro do agente casar com algo que ninguém
    // escreveu. Erro explícito na fronteira.
    expect(() => parseFrontmatter(md('category: [a, b]'))).toThrow(/category/);
    expect(() => parseFrontmatter(md('category: 42'))).toThrow(/category/);
  });

  it('execution default é `remote` — o caso comum não exige declaração', () => {
    // A maioria das skills é só instrução. Exigir o campo faria toda skill trivial
    // carregar cerimônia, e cerimônia esquecida vira erro de publicação, não segurança.
    expect(parseFrontmatter(md('')).execution).toBe('remote');
  });

  it('execution aceita `remote` e `local`, e recusa o resto', () => {
    expect(parseFrontmatter(md('execution: remote')).execution).toBe('remote');
    expect(parseFrontmatter(md('execution: local')).execution).toBe('local');
    // Um `execution: sandbox` caindo no default entregaria como remota uma skill que o
    // autor quis restringir — o silêncio aqui é o modo de falha perigoso.
    expect(() => parseFrontmatter(md('execution: sandbox'))).toThrow(/execution/);
    expect(() => parseFrontmatter(md('execution: LOCAL'))).toThrow(/execution/);
  });
});
