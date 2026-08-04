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

describe('ausência no acervo não é regressão de descoberta', () => {
  // A distinção que o AC1 do M34 exige — "rodando contra o ACERVO REAL do workspace, não contra
  // fixture sintética". Um dataset que roda contra o acervo real encontra, mais cedo ou mais
  // tarde, uma skill que foi APAGADA. Duas leituras possíveis, e só uma é verdadeira:
  //
  //   "a descoberta piorou"        → falso: não há o que descobrir
  //   "a skill não está mais lá"   → verdadeiro, e é outro problema, de outro dono
  //
  // Sem a distinção o gate acusa a equipe de busca por uma decisão de curadoria. Pior: um
  // dataset escrito para OUTRO ambiente acha zero em todos os casos, grava baseline de zeros e
  // o gate volta a ser inerte — pelo caminho oposto ao que já corrigimos.
  const caso = (over: Partial<ResultadoEval> = {}): ResultadoEval => ({
    query: 'converter dólar para real',
    esperada: 'sk_cambio',
    achada: false,
    posicao: null,
    existe: true,
    ...over,
  });

  it('skill que sumiu do acervo NÃO conta como regressão', () => {
    const baseline = [caso({ achada: true, posicao: 1 })];
    const agora = [caso({ achada: false, existe: false })];
    expect(detectarRegressoes(agora, baseline)).toEqual([]);
  });

  it('skill que CONTINUA no acervo e deixou de ser achada É regressão', () => {
    // O caso que o gate existe para pegar — e o contraste que prova que o filtro acima não
    // engoliu o achado de verdade.
    const baseline = [caso({ achada: true, posicao: 1 })];
    const agora = [caso({ achada: false, existe: true })];
    expect(detectarRegressoes(agora, baseline)).toHaveLength(1);
  });

  it('sem a informação de existência, assume presente — não silencia o gate', () => {
    // `existe` é opcional para não quebrar baselines já gravadas. O default tem de ser o que
    // MANTÉM o gate ativo: assumir "não existe" desligaria a detecção em todo caso antigo.
    const baseline = [caso({ achada: true, posicao: 1 })];
    const semCampo = { query: caso().query, esperada: caso().esperada, achada: false, posicao: null };
    expect(detectarRegressoes([semCampo], baseline)).toHaveLength(1);
  });
});
