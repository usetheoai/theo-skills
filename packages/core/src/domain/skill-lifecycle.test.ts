import { describe, expect, it } from 'vitest';

import {
  buildLifecycleFilter,
  InvalidLifecycleError,
  isValidLifecycle,
  parseLifecycle,
  SKILL_LIFECYCLES,
  type SkillLifecycle,
} from './skill-lifecycle.js';

describe('parseLifecycle', () => {
  it('accepts the three stages', () => {
    for (const ok of ['active', 'draft', 'deprecated'] satisfies SkillLifecycle[]) {
      expect(parseLifecycle(ok)).toBe(ok);
    }
  });

  it('normalizes case and surrounding whitespace', () => {
    // A entrada vem de HTTP e de CLI; exigir caixa exata transformaria erro de digitação
    // em 4xx sem necessidade. O peer investigado normaliza pelo mesmo motivo.
    expect(parseLifecycle('DEPRECATED')).toBe('deprecated');
    expect(parseLifecycle('  Draft  ')).toBe('draft');
  });

  it('rejects the empty string with a typed error', () => {
    expect(() => parseLifecycle('')).toThrow(InvalidLifecycleError);
  });

  it('rejects DELETED because exclusion is a different axis', () => {
    // `DELETED` pertence a `skills.state` (soft-delete com reserva de id). Aceitá-lo aqui
    // fundiria duas dimensões que o ADR D1 mantém deliberadamente separadas.
    expect(() => parseLifecycle('DELETED')).toThrow(InvalidLifecycleError);
  });

  it('carries the offending value and a stable code on the error', () => {
    try {
      parseLifecycle('retired');
      expect.unreachable('parseLifecycle should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidLifecycleError);
      const typed = error as InvalidLifecycleError;
      expect(typed.code).toBe('INVALID_LIFECYCLE');
      expect(typed.value).toBe('retired');
      // A mensagem enumera o vocabulário: quem lê o erro não precisa procurar a documentação.
      expect(typed.message).toContain('active');
    }
  });
});

describe('isValidLifecycle', () => {
  it('answers without throwing', () => {
    expect(isValidLifecycle('active')).toBe(true);
    expect(isValidLifecycle('nope')).toBe(false);
  });
});

describe('SKILL_LIFECYCLES', () => {
  it('is the single source of the vocabulary', () => {
    expect([...SKILL_LIFECYCLES]).toEqual(['active', 'draft', 'deprecated']);
  });
});

describe('buildLifecycleFilter', () => {
  it('excludes draft, deprecated and disabled by default', () => {
    expect(buildLifecycleFilter()).toEqual({ stages: ['active'], requireEnabled: true });
  });

  it('keeps filtering stages when disabled are included — the two axes compose', () => {
    // Esta é a asserção que prova a ortogonalidade (ADR D1). Se um dia pedir os
    // desabilitados passar a devolver rascunhos junto, as dimensões colapsaram.
    expect(buildLifecycleFilter({ includeDisabled: true })).toEqual({
      stages: ['active'],
      requireEnabled: false,
    });
  });

  it('including draft still excludes deprecated', () => {
    expect(buildLifecycleFilter({ includeDraft: true })).toEqual({
      stages: ['active', 'draft'],
      requireEnabled: true,
    });
  });

  it('including deprecated still excludes draft', () => {
    expect(buildLifecycleFilter({ includeDeprecated: true })).toEqual({
      stages: ['active', 'deprecated'],
      requireEnabled: true,
    });
  });

  it('including everything yields no restriction at all', () => {
    expect(
      buildLifecycleFilter({ includeDraft: true, includeDeprecated: true, includeDisabled: true }),
    ).toEqual({ stages: ['active', 'draft', 'deprecated'], requireEnabled: false });
  });

  it('returns a fresh stages array so callers cannot mutate shared state', () => {
    const first = buildLifecycleFilter();
    first.stages.push('draft');
    expect(buildLifecycleFilter().stages).toEqual(['active']);
  });
});
