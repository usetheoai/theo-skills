import { describe, expect, it } from 'vitest';

import {
  diagnosticarDescobribilidade,
  DISCOVERABILITY_CAUSES,
  type CandidataVizinha,
} from './discoverability.js';

/**
 * M34 — medir, SEM EXECUTAR a skill, se ela é achada pela intenção que deveria encontrá-la.
 *
 * O `:validate` do M30 responde se a skill é **válida**. Nada respondia se ela é **achável**, que
 * é a promessa do produto.
 *
 * O critério que carrega este milestone: **o resultado nomeia a CAUSA, não só o número**. Um
 * recall sem diagnóstico não diz ao autor o que corrigir — ele lê "0.3" e não sabe se o problema
 * é a descrição, a falta de vetor, ou uma vizinha que rouba a consulta.
 */

const semVizinhas: CandidataVizinha[] = [];

describe('diagnosticarDescobribilidade — a causa, não só o número', () => {
  it('descrição curta demais é nomeada como tal', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Conversor',
      description: 'converte',
      hasEmbedding: true,
      vizinhas: semVizinhas,
    });

    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
    // A causa vem com O QUE FAZER. Sem isto o autor lê o rótulo e continua sem saber o próximo
    // passo — que é o defeito de um recall sem diagnóstico.
    expect(d.hints.some((h) => h.toLowerCase().includes('quando'))).toBe(true);
  });

  it('descrição específica NÃO é acusada — senão a causa vira ruído', () => {
    // A metade que impede o diagnóstico de virar "reclama sempre". Um detector que acusa toda
    // skill é indistinguível de nenhum detector.
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação de fechamento do dia.',
      hasEmbedding: true,
      vizinhas: semVizinhas,
    });

    expect(d.causes).not.toContain(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
  });

  it('sem embedding é causa PRÓPRIA — a skill só aparece para quem já sabe o nome', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação de fechamento do dia.',
      hasEmbedding: false,
      vizinhas: semVizinhas,
    });

    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
  });

  it('colisão com uma vizinha do acervo é nomeada com QUEM colide', () => {
    // Dizer "colide" sem dizer com quem deixaria o autor procurando a rival no acervo inteiro.
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação do dia.',
      hasEmbedding: true,
      vizinhas: [{ skillId: 'sk_cambio_v1', similaridade: 0.94 }],
    });

    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
    expect(d.hints.join(' ')).toContain('sk_cambio_v1');
  });

  it('uma vizinha DISTANTE não é colisão', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação do dia.',
      hasEmbedding: true,
      vizinhas: [{ skillId: 'sk_outra', similaridade: 0.31 }],
    });

    expect(d.causes).not.toContain(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
  });

  it('sem causa alguma, o veredito é descobrível', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação de fechamento do dia.',
      hasEmbedding: true,
      vizinhas: semVizinhas,
    });

    expect(d.causes).toEqual([]);
    expect(d.discoverable).toBe(true);
  });

  it('qualquer causa torna o veredito NÃO descobrível', () => {
    const d = diagnosticarDescobribilidade({
      name: 'x',
      description: 'converte',
      hasEmbedding: false,
      vizinhas: semVizinhas,
    });

    expect(d.discoverable).toBe(false);
    // As causas se ACUMULAM: reportar só a primeira faria o autor corrigir uma, republicar, e
    // descobrir a seguinte — um ciclo por defeito.
    expect(d.causes.length).toBeGreaterThan(1);
  });

  it('a ordem das causas é estável — o relatório não pode dançar entre execuções', () => {
    const entrada = {
      name: 'x',
      description: 'converte',
      hasEmbedding: false,
      vizinhas: [{ skillId: 'sk_a', similaridade: 0.95 }],
    };
    expect(diagnosticarDescobribilidade(entrada).causes).toEqual(
      diagnosticarDescobribilidade(entrada).causes,
    );
  });
});
