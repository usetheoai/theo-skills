import { describe, expect, it } from 'vitest';

import { ALL_SCOPES, type Scope, scopeSatisfies } from './scope.js';

/**
 * M12 DoD #2 — hierarquia de scopes de capacidade.
 *
 * Espelha o precedente `roleSatisfies` (`principal.ts`) e o `scopeSatisfies` do
 * theo-memory: um scope mais privilegiado SATISFAZ a exigência de um mais fino que
 * ele implica. A diferença em relação ao theo-memory é o eixo: lá a implicação é
 * plana (`platform-admin ⊇ admin`); aqui as capacidades formam uma CADEIA, porque
 * publicar pressupõe escrever, e escrever pressupõe ler.
 */
describe('scopeSatisfies — hierarquia de capacidade', () => {
  it('satisfação exata: um scope sempre satisfaz a si mesmo', () => {
    for (const s of ALL_SCOPES) {
      expect(scopeSatisfies([s], s), `${s} não satisfez a si mesmo`).toBe(true);
    }
  });

  it('a cadeia admin ⊃ publish ⊃ write ⊃ read é transitiva', () => {
    // Transitividade importa: sem ela, `admin` precisaria carregar os quatro scopes
    // explicitamente, e esquecer um significa uma rota inacessível ao administrador.
    expect(scopeSatisfies(['skills:admin'], 'skills:read')).toBe(true);
    expect(scopeSatisfies(['skills:admin'], 'skills:write')).toBe(true);
    expect(scopeSatisfies(['skills:admin'], 'skills:publish')).toBe(true);
    expect(scopeSatisfies(['skills:publish'], 'skills:write')).toBe(true);
    expect(scopeSatisfies(['skills:publish'], 'skills:read')).toBe(true);
    expect(scopeSatisfies(['skills:write'], 'skills:read')).toBe(true);
  });

  it('a implicação NÃO é simétrica — ler jamais concede escrever', () => {
    // É o teste que impede a regressão mais cara: uma tabela de implicação escrita
    // ao contrário passa em todos os testes positivos acima.
    expect(scopeSatisfies(['skills:read'], 'skills:write')).toBe(false);
    expect(scopeSatisfies(['skills:read'], 'skills:publish')).toBe(false);
    expect(scopeSatisfies(['skills:read'], 'skills:admin')).toBe(false);
    expect(scopeSatisfies(['skills:write'], 'skills:publish')).toBe(false);
    expect(scopeSatisfies(['skills:write'], 'skills:admin')).toBe(false);
    expect(scopeSatisfies(['skills:publish'], 'skills:admin')).toBe(false);
  });

  it('conjunto vazio não satisfaz nada', () => {
    for (const s of ALL_SCOPES) {
      expect(scopeSatisfies([], s), `[] satisfez ${s}`).toBe(false);
    }
  });

  it('scope desconhecido não satisfaz nada, e não explode', () => {
    // Fail-closed: um scope que o servidor não reconhece (chave antiga, provider
    // externo, erro de digitação) NUNCA pode conceder acesso por omissão.
    expect(scopeSatisfies(['skills:superuser' as Scope], 'skills:read')).toBe(false);
    expect(scopeSatisfies(['' as Scope], 'skills:read')).toBe(false);
  });

  it('um conjunto com vários scopes satisfaz pela união', () => {
    expect(scopeSatisfies(['skills:read', 'skills:publish'], 'skills:write')).toBe(true);
  });
});
