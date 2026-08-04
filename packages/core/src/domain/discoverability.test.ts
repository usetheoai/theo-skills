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
      revisao: { publicada: true, temVetor: true },
      vizinhas: semVizinhas,
    });

    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
    // A causa vem com O QUE FAZER. Sem isto o autor lê o rótulo e continua sem saber o próximo
    // passo — que é o defeito de um recall sem diagnóstico.
    expect(d.hints.some((h) => h.toLowerCase().includes('when'))).toBe(true);
  });

  it('descrição específica NÃO é acusada — senão a causa vira ruído', () => {
    // A metade que impede o diagnóstico de virar "reclama sempre". Um detector que acusa toda
    // skill é indistinguível de nenhum detector.
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação de fechamento do dia.',
      revisao: { publicada: true, temVetor: true },
      vizinhas: semVizinhas,
    });

    expect(d.causes).not.toContain(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
  });

  it('sem embedding é causa PRÓPRIA — a skill só aparece para quem já sabe o nome', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação de fechamento do dia.',
      revisao: { publicada: true, temVetor: false },
      vizinhas: semVizinhas,
    });

    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
  });

  it('colisão com uma vizinha do acervo é nomeada com QUEM colide', () => {
    // Dizer "colide" sem dizer com quem deixaria o autor procurando a rival no acervo inteiro.
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação do dia.',
      revisao: { publicada: true, temVetor: true },
      vizinhas: [{ skillId: 'sk_cambio_v1', similaridade: 0.94 }],
    });

    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
    expect(d.hints.join(' ')).toContain('sk_cambio_v1');
  });

  it('uma vizinha DISTANTE não é colisão', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação do dia.',
      revisao: { publicada: true, temVetor: true },
      vizinhas: [{ skillId: 'sk_outra', similaridade: 0.31 }],
    });

    expect(d.causes).not.toContain(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
  });

  it('sem causa alguma, o veredito é descobrível', () => {
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação de fechamento do dia.',
      revisao: { publicada: true, temVetor: true },
      vizinhas: semVizinhas,
    });

    expect(d.causes).toEqual([]);
    expect(d.discoverable).toBe(true);
  });

  it('qualquer causa torna o veredito NÃO descobrível', () => {
    const d = diagnosticarDescobribilidade({
      name: 'x',
      description: 'converte',
      revisao: { publicada: true, temVetor: false },
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
      revisao: { publicada: true, temVetor: false },
      vizinhas: [{ skillId: 'sk_a', similaridade: 0.95 }],
    };
    expect(diagnosticarDescobribilidade(entrada).causes).toEqual(
      diagnosticarDescobribilidade(entrada).causes,
    );
  });
});

describe('rascunho ainda não publicado — theo-skills#144', () => {
  // O diagnóstico do M34 roda no momento da AUTORIA, antes de publicar. Nesse contexto a skill
  // ainda não tem revisão, logo não tem vetor — por definição, não por defeito.
  //
  // MEDIDO no app-dev em 2026-08-04: a tela mandava `has_embedding: false` fixo e o diagnóstico
  // respondia `causes: ["no_embedding"]` com o conselho *"Republique para gerar o vetor"* —
  // instrução impossível para algo que nunca foi publicado.
  //
  // Pior que o conselho inútil: `no_embedding` sempre disparava e DOMINAVA o veredito, encobrindo
  // as causas que o autor de fato poderia corrigir antes de publicar — descrição genérica e
  // colisão com uma vizinha. A pergunta que ele fez ("minha descrição está boa?") ficava sem
  // resposta, soterrada por um fato estrutural sobre o qual ele nada pode fazer naquele momento.

  const rascunho = {
    name: 'Converter moeda',
    description: 'Converte moeda estrangeira para reais usando a cotação do dia, com a taxa oficial.',
    revisao: { publicada: false } as const,
  };

  it('rascunho NÃO acusa falta de vetor — ele não tem revisão para ter vetor', () => {
    const d = diagnosticarDescobribilidade({ ...rascunho, vizinhas: [] });
    expect(d.causes).not.toContain(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
    expect(d.discoverable).toBe(true);
  });

  it('rascunho AINDA acusa o que o autor pode corrigir agora', () => {
    // O ponto inteiro da correção: as causas acionáveis não podem ser encobertas.
    const d = diagnosticarDescobribilidade({
      ...rascunho,
      description: 'Converte moeda.',
      vizinhas: [{ skillId: 'sk_cambio_v1', similaridade: 0.95 }],
    });
    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.DESCRIPTION_TOO_GENERIC);
    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.COLLIDES_WITH_SIBLING);
    expect(d.causes).not.toContain(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
  });

  it('skill PUBLICADA sem vetor continua acusando — ali o achado é real', () => {
    // O contraste que prova que a correção não desligou o detector: para uma revisão publicada,
    // faltar vetor é um defeito de ingestão e o autor PODE agir (republicar, investigar).
    const d = diagnosticarDescobribilidade({
      name: rascunho.name,
      description: rascunho.description,
      revisao: { publicada: true, temVetor: false },
      vizinhas: [],
    });
    expect(d.causes).toContain(DISCOVERABILITY_CAUSES.NO_EMBEDDING);
  });

  it('publicada COM vetor não acusa nada', () => {
    const d = diagnosticarDescobribilidade({
      name: rascunho.name,
      description: rascunho.description,
      revisao: { publicada: true, temVetor: true },
      vizinhas: [],
    });
    expect(d.causes).toEqual([]);
    expect(d.discoverable).toBe(true);
  });

  it('o rascunho recebe UM hint, não dois — cada causa fala uma vez', () => {
    // Um `git merge` reintroduziu o bloco inteiro do hint numa segunda versão, e a função passou a
    // empurrar DOIS hints para o mesmo rascunho — um em cada idioma. Nenhum teste pegou: todos
    // assertavam PRESENÇA (`toContain`, `toMatch`), e presença é indiferente à duplicata.
    //
    // O gate do CHANGELOG foi quem expôs, por um caminho indireto: ele apontou o arquivo tocado
    // sem entrada, e foi lendo o diff do merge que a duplicação apareceu.
    const d = diagnosticarDescobribilidade({
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação do dia, com a taxa oficial.',
      revisao: { publicada: false },
      vizinhas: [],
    });
    expect(d.hints).toHaveLength(1);
    // E não há duas frases dizendo a mesma coisa em idiomas diferentes.
    expect(new Set(d.hints).size).toBe(d.hints.length);
  });

  it('o hint do rascunho fala de PUBLICAR, não de republicar', () => {
    // Um rascunho com tudo certo ainda não é achável — porque não existe. Dizer "descobrível"
    // sem ressalva afirmaria algo falso sobre o presente.
    const d = diagnosticarDescobribilidade({ ...rascunho, vizinhas: [] });
    expect(d.hints.join(' ')).toMatch(/published/i);
    expect(d.hints.join(' ')).not.toMatch(/republish/i);
  });
});
