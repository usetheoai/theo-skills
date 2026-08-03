import { describe, expect, it } from 'vitest';

import { DESPEJO_ACIMA_DE, despejarVencidos } from '../../src/server/handlers/distribution.js';

/**
 * O despejo dos contadores de quota.
 *
 * Sem ele o `Map` guardava uma entrada por credencial JÁ VISTA e nunca a removia — um
 * vazamento lento, do tipo que aparece como reinício periódico que ninguém sabe explicar.
 *
 * Testado como função pura porque disparar o despejo por requisições exigiria mais de 4096
 * chamadas: um teste desses seria lento e frágil o bastante para ser desligado no primeiro
 * dia ruim, e teste desligado é pior que teste ausente — ele mente sobre a cobertura.
 */
const bucket = (resetAt: number) => ({ count: 1, resetAt });

describe('despejo dos contadores de quota', () => {
  it('abaixo do limiar não varre nada — o caminho quente não paga a varredura', () => {
    const m = new Map([['t1', bucket(0)]]);
    expect(despejarVencidos(m, 1_000)).toBe(0);
    expect(m.size, 'o bucket vencido FICA: varrer a cada requisição custaria latência constante').toBe(1);
  });

  it('acima do limiar remove os vencidos e PRESERVA os vivos', () => {
    const m = new Map<string, { count: number; resetAt: number }>();
    for (let i = 0; i < 3; i++) m.set(`vencido-${i}`, bucket(500));
    for (let i = 0; i < 2; i++) m.set(`vivo-${i}`, bucket(9_000));

    expect(despejarVencidos(m, 1_000, 4)).toBe(3);
    expect([...m.keys()].sort(), 'só os vivos sobrevivem').toEqual(['vivo-0', 'vivo-1']);
  });

  it('o limiar padrão é folgado — quem tem poucas credenciais nunca paga', () => {
    // Bem acima do número de credenciais ativas de um publisher real.
    expect(DESPEJO_ACIMA_DE).toBeGreaterThanOrEqual(1024);
  });

  it('nada vencido acima do limiar: não remove nada e não quebra', () => {
    const m = new Map([['a', bucket(9_000)], ['b', bucket(9_000)]]);
    expect(despejarVencidos(m, 1_000, 1)).toBe(0);
    expect(m.size).toBe(2);
  });
});
