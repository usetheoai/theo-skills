import { describe, expect, it } from 'vitest';

import { detectarRegressoes, type ResultadoEval } from './regression-gate.js';

/**
 * M34 — o gate que distingue este eval de um relatório.
 *
 * O critério da DoD: *"uma skill que era achada e deixa de ser REPROVA o gate"*. Sem isso, uma
 * regressão de descoberta passa despercebida até um usuário reclamar que a skill "sumiu".
 *
 * Comparar contra um piso absoluto (recall ≥ 0.8) mediria o EMBEDDER, não a mudança — e com o
 * stub o número diz mais sobre a infraestrutura do que sobre a descrição.
 */

const r = (esperada: string, achada: boolean, query = `q-${esperada}`): ResultadoEval => ({
  query,
  esperada,
  achada,
  posicao: achada ? 1 : null,
});

describe('detectarRegressoes', () => {
  it('achada ANTES e não agora é regressão', () => {
    const regs = detectarRegressoes([r('sk_a', false)], [r('sk_a', true)]);
    expect(regs.map((x) => x.esperada)).toEqual(['sk_a']);
  });

  it('nunca achada NÃO é regressão — é uma falha conhecida, não uma piora', () => {
    // Tratar como regressão faria o gate reprovar para sempre por um caso que nunca passou, e um
    // gate que reprova sempre é um gate que se desliga.
    expect(detectarRegressoes([r('sk_a', false)], [r('sk_a', false)])).toEqual([]);
  });

  it('passou a ser achada é MELHORA, não regressão', () => {
    expect(detectarRegressoes([r('sk_a', true)], [r('sk_a', false)])).toEqual([]);
  });

  it('um caso NOVO não regride contra uma baseline que não o conhece', () => {
    // Adicionar consulta ao dataset não pode reprovar o gate: o caso novo não tinha estado
    // anterior, e chamá-lo de regressão puniria quem melhora a cobertura.
    expect(detectarRegressoes([r('sk_novo', false)], [r('sk_a', true)])).toEqual([]);
  });

  it('a MESMA skill com consulta diferente é caso diferente', () => {
    // Uma skill pode ser achada por uma frase e não por outra — e é exatamente essa diferença
    // que o dataset existe para capturar.
    const baseline = [r('sk_a', true, 'frase-1'), r('sk_a', true, 'frase-2')];
    const agora = [r('sk_a', true, 'frase-1'), r('sk_a', false, 'frase-2')];
    expect(detectarRegressoes(agora, baseline).map((x) => x.query)).toEqual(['frase-2']);
  });

  it('baseline vazia não acusa nada', () => {
    expect(detectarRegressoes([r('sk_a', false)], [])).toEqual([]);
  });
});
