import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRINCIPAL,
  DEFAULT_WORKSPACE_ID,
  roleSatisfies,
  type WorkspaceRole,
} from './principal.js';

describe('roleSatisfies', () => {
  it('owner satisfaz qualquer mínimo', () => {
    for (const min of ['member', 'admin', 'owner'] as WorkspaceRole[]) {
      expect(roleSatisfies('owner', min), `owner deveria satisfazer ${min}`).toBe(true);
    }
  });

  it('member satisfaz apenas member', () => {
    expect(roleSatisfies('member', 'member')).toBe(true);
    expect(roleSatisfies('member', 'admin')).toBe(false);
    expect(roleSatisfies('member', 'owner')).toBe(false);
  });

  it('admin satisfaz member e admin, mas não owner', () => {
    expect(roleSatisfies('admin', 'member')).toBe(true);
    expect(roleSatisfies('admin', 'admin')).toBe(true);
    expect(roleSatisfies('admin', 'owner')).toBe(false);
  });
});

describe('ponte legada', () => {
  it('o workspace default é um literal estável, não um id gerado', () => {
    // Um UUID gerado por boot faria cada reinício criar um inquilino novo, deixando os
    // dados anteriores inalcançáveis na instalação single-tenant.
    expect(DEFAULT_WORKSPACE_ID).toBe('default');
    expect(DEFAULT_PRINCIPAL.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('não age em nome de nenhum membro', () => {
    expect(DEFAULT_PRINCIPAL.userId).toBeNull();
  });

  it('é imutável — ninguém escala privilégio mutando o objeto compartilhado', () => {
    expect(Object.isFrozen(DEFAULT_PRINCIPAL)).toBe(true);
    expect(() => {
      (DEFAULT_PRINCIPAL as { workspaceId: string }).workspaceId = 'outro';
    }).toThrow();
    expect(DEFAULT_PRINCIPAL.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });
});
