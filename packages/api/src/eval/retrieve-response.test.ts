import { describe, expect, it } from 'vitest';

import { idsDaResposta } from './retrieve-response.js';

/**
 * M34 — a leitura da resposta de `:retrieve` pelo gate de descobribilidade.
 *
 * Este teste existe por causa de um defeito MEU, encontrado durante a aceitação do próprio M34:
 * `eval/run-discoverability.ts` lia `body.skills`, e o handler devolve **`results`**
 * (`handlers/retrieve.ts:125-127`).
 *
 * A consequência é pior do que "o eval erra o número". Como `body.skills` é sempre `undefined`,
 * a lista vinha vazia, NENHUM caso era achado, e a primeira execução gravava uma baseline de
 * zeros. A partir daí o gate ficava **inerte para sempre**: não existe regressão possível a
 * partir de "nunca foi achada". O critério do M34 — *"uma skill que era achada e deixa de ser
 * reprova o gate"* — estaria mecanicamente satisfeito e semanticamente vazio.
 *
 * Um gate que não pode reprovar é pior que gate nenhum: ele ocupa o lugar de um.
 *
 * A leitura mora aqui, e não dentro do runner, porque `eval/` fica fora do `tsconfig` e nada em
 * `eval/` é alcançado por teste — que é exatamente por que o defeito sobreviveu ao ser escrito.
 */

describe('idsDaResposta', () => {
  it('lê `results` — a chave que o handler de fato devolve', () => {
    const body = {
      trace_id: 'trc_x',
      results: [{ skill_id: 'sk_a' }, { skill_id: 'sk_b' }],
    };
    expect(idsDaResposta(body)).toEqual(['sk_a', 'sk_b']);
  });

  it('`skills` NÃO é a chave — ler dela devolveria vazio para sempre', () => {
    // Este é o corpo que o runner ANTIGO esperava. Se alguém reintroduzir a leitura de `skills`,
    // este caso continua devolvendo vazio e o de cima reprova.
    const corpoQueNinguemDevolve = { skills: [{ skill_id: 'sk_a' }] };
    expect(idsDaResposta(corpoQueNinguemDevolve)).toEqual([]);
  });

  it('preserva a ORDEM, porque a posição é o que o gate reporta', () => {
    const body = { results: [{ skill_id: 'sk_z' }, { skill_id: 'sk_a' }, { skill_id: 'sk_m' }] };
    expect(idsDaResposta(body)).toEqual(['sk_z', 'sk_a', 'sk_m']);
  });

  it('resposta sem resultados devolve lista vazia, sem lançar', () => {
    expect(idsDaResposta({ trace_id: 't', results: [] })).toEqual([]);
    expect(idsDaResposta({ trace_id: 't' })).toEqual([]);
  });

  it('corpo malformado não derruba o gate nem inventa resultado', () => {
    expect(idsDaResposta(null)).toEqual([]);
    expect(idsDaResposta(undefined)).toEqual([]);
    expect(idsDaResposta('não é json de verdade')).toEqual([]);
    expect(idsDaResposta({ results: 'não é lista' })).toEqual([]);
  });

  it('descarta entrada sem `skill_id` em vez de produzir undefined na lista', () => {
    // Um `undefined` na lista vira uma posição fantasma no relatório do gate.
    const body = { results: [{ skill_id: 'sk_a' }, { nome: 'sem id' }, { skill_id: 'sk_c' }] };
    expect(idsDaResposta(body)).toEqual(['sk_a', 'sk_c']);
  });
});
