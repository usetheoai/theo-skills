import { describe, expect, it } from 'vitest';

import {
  assertPublishable,
  compareVersions,
  formatVersion,
  InvalidVersionError,
  parseVersion,
  resolveRange,
  VersionRejectedError,
} from './version.js';

const v = (s: string) => parseVersion(s);
const vs = (...xs: string[]) => xs.map(v);

describe('parseVersion', () => {
  it('aceita versões válidas, com e sem pré-lançamento', () => {
    expect(v('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(v('0.0.1-beta.2')).toEqual({ major: 0, minor: 0, patch: 1, prerelease: 'beta.2' });
    expect(formatVersion(v('1.2.3-rc.1'))).toBe('1.2.3-rc.1');
  });

  it('recusa formatos inválidos — inclusive build metadata', () => {
    // Metadata (`+sha`) não participa da precedência (semver.org § 10). Aceitá-la criaria
    // duas versões que se comparam como IGUAIS mas diferem como string, e a unicidade do
    // registry passaria a depender de algo que a ordenação ignora.
    for (const bad of ['1.2', 'v1.2.3', '1.2.3.4', '', 'latest', '1.2.3+abc']) {
      expect(() => v(bad), `aceitou "${bad}"`).toThrow(InvalidVersionError);
    }
  });
});

describe('compareVersions', () => {
  it('ordena por major, minor e patch', () => {
    expect(compareVersions(v('1.0.0'), v('2.0.0'))).toBe(-1);
    expect(compareVersions(v('1.2.0'), v('1.10.0'))).toBe(-1); // numérico, não lexicográfico
    expect(compareVersions(v('1.0.1'), v('1.0.1'))).toBe(0);
  });

  it('lançamento tem precedência sobre pré-lançamento', () => {
    // O oposto da intuição alfabética. Inverter faria um beta parecer mais novo que o release.
    expect(compareVersions(v('1.0.0'), v('1.0.0-beta'))).toBe(1);
    expect(compareVersions(v('1.0.0-beta'), v('1.0.0'))).toBe(-1);
  });

  it('ordena pré-lançamentos conforme semver § 11.4', () => {
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-beta'))).toBe(-1);
    expect(compareVersions(v('1.0.0-alpha.1'), v('1.0.0-alpha.2'))).toBe(-1);
    // numérico < alfanumérico
    expect(compareVersions(v('1.0.0-1'), v('1.0.0-alpha'))).toBe(-1);
    // conjunto menor de campos < conjunto maior, quando o prefixo é igual
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-alpha.1'))).toBe(-1);
  });
});

describe('assertPublishable', () => {
  it('aceita a primeira versão e qualquer avanço', () => {
    expect(() => assertPublishable(v('1.0.0'), [])).not.toThrow();
    expect(() => assertPublishable(v('1.0.1'), vs('1.0.0'))).not.toThrow();
  });

  it('RECUSA duplicata — republicar a mesma versão com outro conteúdo', () => {
    // É o que faria `@^1.2.0` resolver para bytes diferentes conforme o momento.
    try {
      assertPublishable(v('1.0.0'), vs('1.0.0', '0.9.0'));
      expect.unreachable('deveria ter recusado');
    } catch (e) {
      expect(e).toBeInstanceOf(VersionRejectedError);
      expect((e as VersionRejectedError).reason).toBe('duplicate');
    }
  });

  it('RECUSA retrocesso', () => {
    try {
      assertPublishable(v('1.0.0'), vs('1.1.0'));
      expect.unreachable('deveria ter recusado');
    } catch (e) {
      expect((e as VersionRejectedError).reason).toBe('not_greater');
    }
  });

  it('aceita pré-lançamento posterior ao último release', () => {
    expect(() => assertPublishable(v('2.0.0-beta.1'), vs('1.9.0'))).not.toThrow();
  });
});

describe('resolveRange', () => {
  const acervo = vs('1.0.0', '1.1.0', '1.2.0', '1.2.1', '2.0.0', '2.1.0-beta.1', '0.1.0', '0.2.0');

  it('`latest` devolve a maior ESTÁVEL, nunca um pré-lançamento', () => {
    expect(formatVersion(resolveRange('latest', acervo)!)).toBe('2.0.0');
  });

  it('versão exata resolve para ela mesma, inclusive pré-lançamento', () => {
    expect(formatVersion(resolveRange('1.2.0', acervo)!)).toBe('1.2.0');
    expect(formatVersion(resolveRange('2.1.0-beta.1', acervo)!)).toBe('2.1.0-beta.1');
  });

  it('`^1.0.0` pega a maior do MESMO major', () => {
    expect(formatVersion(resolveRange('^1.0.0', acervo)!)).toBe('1.2.1');
  });

  it('`~1.1.0` não cruza o minor', () => {
    expect(formatVersion(resolveRange('~1.1.0', acervo)!)).toBe('1.1.0');
    expect(formatVersion(resolveRange('~1.2.0', acervo)!)).toBe('1.2.1');
  });

  it('`^0.x.y` NÃO cruza o minor — com major 0 a API é instável', () => {
    // Ignorar isto faria `^0.1.0` aceitar `0.2.0`, que é uma quebra por definição do semver.
    expect(formatVersion(resolveRange('^0.1.0', acervo)!)).toBe('0.1.0');
  });

  it('pré-lançamento NUNCA satisfaz um intervalo', () => {
    // Regra do npm: publicar `2.1.0-beta.1` não pode empurrar quem pediu `^2.0.0` para um beta.
    expect(formatVersion(resolveRange('^2.0.0', acervo)!)).toBe('2.0.0');
  });

  it('devolve null quando nada satisfaz, e para intervalo malformado', () => {
    expect(resolveRange('^9.0.0', acervo)).toBeNull();
    expect(resolveRange('>=1.0.0', acervo)).toBeNull();
    expect(resolveRange('latest', [])).toBeNull();
  });
});
