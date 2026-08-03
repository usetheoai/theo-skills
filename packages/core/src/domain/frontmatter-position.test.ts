import { describe, expect, it } from 'vitest';

import { parseFrontmatter, SkillFrontmatterError } from './frontmatter.js';

/**
 * T1b do M30 — o erro precisa dizer ONDE, não só QUE.
 *
 * Hoje o campo já viaja: `'missing required field: name'`. Mas como **texto**, dentro da
 * mensagem. Um editor que queira pintar a linha errada tem de fazer regex na prosa — e a prosa
 * muda sem aviso, porque ninguém a trata como contrato.
 *
 * A asserção que DISCRIMINA é `err.field === 'name'` como DADO. Uma implementação que só
 * melhorasse a mensagem passaria em qualquer verificação de `toContain('name')` e continuaria
 * inútil para quem precisa DECIDIR sobre o campo.
 *
 * `line` é 1-indexado e conta a partir do início do SKILL.md — é o que o editor usa para
 * posicionar o cursor. Zero-indexado pintaria a linha de cima, que é pior que não pintar.
 */

const skillMd = (frontmatter: string): string => `---\n${frontmatter}\n---\n\n# Corpo\n`;

describe('frontmatter: o erro carrega campo e linha como DADO (M30 AC4)', () => {
  it('campo ausente → `field` é o nome do campo, não texto na mensagem', () => {
    let erro: SkillFrontmatterError | undefined;
    try {
      parseFrontmatter(skillMd('description: sem nome'));
    } catch (e) {
      erro = e as SkillFrontmatterError;
    }
    expect(erro, 'esperava recusa por campo obrigatório ausente').toBeInstanceOf(SkillFrontmatterError);
    // A asserção central: `field` navegável, não substring.
    expect(erro?.field, 'o campo não veio como dado — um editor teria de fazer regex na prosa').toBe('name');
  });

  it('campo presente mas inválido → `field` E `line` apontam para ELE', () => {
    // `name` na linha 2 do arquivo (linha 1 é o `---` de abertura).
    const fonte = skillMd(`name: ${'x'.repeat(500)}\ndescription: ok`);
    let erro: SkillFrontmatterError | undefined;
    try {
      parseFrontmatter(fonte);
    } catch (e) {
      erro = e as SkillFrontmatterError;
    }
    expect(erro?.field).toBe('name');
    expect(erro?.line, 'linha 1-indexada, contada do início do SKILL.md').toBe(2);

    // Prova de que a linha é a do CAMPO, e não uma constante: a mesma falha, deslocada,
    // reporta outra linha. Sem isto, `line: 2` fixo passaria nos dois testes.
    let deslocado: SkillFrontmatterError | undefined;
    try {
      parseFrontmatter(skillMd(`description: ok\nname: ${'x'.repeat(500)}`));
    } catch (e) {
      deslocado = e as SkillFrontmatterError;
    }
    expect(deslocado?.line, 'a linha não acompanhou o campo — é constante, não posição').toBe(3);
  });

  it('erro sem campo identificável NÃO inventa um', () => {
    // YAML malformado não tem campo culpado. Reportar um seria pior que reportar nenhum:
    // mandaria o editor pintar a linha errada com confiança.
    let erro: SkillFrontmatterError | undefined;
    try {
      parseFrontmatter(skillMd('isto: [não fecha'));
    } catch (e) {
      erro = e as SkillFrontmatterError;
    }
    expect(erro?.code).toBe('schema_invalid');
    expect(erro?.field, 'inventou um campo para um erro que não tem campo culpado').toBeUndefined();
  });

  it('a mensagem continua legível — campo e linha ACRESCENTAM, não substituem', () => {
    // Regressão: quem já lê `message` não pode perder o texto.
    let erro: SkillFrontmatterError | undefined;
    try {
      parseFrontmatter(skillMd('description: sem nome'));
    } catch (e) {
      erro = e as SkillFrontmatterError;
    }
    expect(erro?.message).toContain('name');
    expect(erro?.code).toBe('schema_invalid');
  });
});
