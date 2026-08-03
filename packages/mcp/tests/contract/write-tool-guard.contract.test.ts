import { describe, expect, it } from 'vitest';

import { createSkillTools } from '../../src/tools.js';

/**
 * A MARCA no ponto de extensão — `theo-skills#114`.
 *
 * Hoje o MCP não tem verificação de escopo alguma, e isso **não** é um defeito: as quatro tools
 * são de leitura, e quem aplica escopo é a API REST, por rota. Não há gate porque não há o que
 * guardar.
 *
 * O risco não é hoje, é **no dia em que alguém adicionar a primeira tool de escrita**. Ela herda
 * a credencial da sessão e não passa por verificação nenhuma nesta camada. Se chamar a rota REST,
 * a API recusa e a proteção se mantém por acidente; se falar com o store direto, o gate some
 * junto — e nada no código atual sinaliza que aquele ponto precisava de um.
 *
 * O caso vizinho (`theo-promptly#52`) é o mesmo defeito já materializado: gate único por endpoint
 * com tool de escrita atrás dele, e uma chave só-leitura criando dataset. Aqui seria **pior**:
 * skill publicada é **instrução executável** que outros agentes carregam.
 *
 * Por que um TESTE e não um comentário: comentário é ignorável, e o custo de descobrir isso
 * depois é uma vulnerabilidade silenciosa. Este teste falha no exato commit que adiciona a
 * primeira tool de escrita — não para impedi-la, mas para que quem a adicione **encontre a
 * condição em vez de descobri-la depois**. A correção, quando o dia chegar, é decidir
 * conscientemente onde o escopo é verificado e atualizar esta lista.
 */

/** As tools de LEITURA conhecidas. Acrescentar aqui é declarar "isto não escreve". */
const SOMENTE_LEITURA = new Set(['search_skills', 'get_skill', 'load_skill', 'list_skill_revisions']);

/** Verbos que denunciam escrita num nome de tool. Heurística — o gate real é a lista acima. */
const VERBOS_DE_ESCRITA = /^(publish|create|update|delete|remove|set|put|promote|revoke|write)_/;

describe('MCP: nenhuma tool de escrita sem decisão explícita sobre escopo (#114)', () => {
  const tools = createSkillTools({} as never);

  it('toda tool exposta está na lista de somente-leitura', () => {
    const desconhecidas = tools.map((t) => t.name).filter((n) => !SOMENTE_LEITURA.has(n));
    expect(
      desconhecidas,
      `Tool(s) nova(s) no MCP: ${desconhecidas.join(', ')}.\n` +
        'Se ela LÊ, acrescente o nome a SOMENTE_LEITURA e siga.\n' +
        'Se ela ESCREVE, PARE: esta camada não verifica escopo (o grep por scope em ' +
        'packages/mcp/src volta vazio). Uma chave só-leitura chegaria até ela. Decida ONDE o ' +
        'escopo é verificado antes de expor a tool — e lembre que skill publicada é instrução ' +
        'executável, então o estrago é maior que o do caso vizinho (theo-promptly#52).',
    ).toEqual([]);
  });

  it('nenhum nome de tool carrega verbo de escrita', () => {
    // Rede de segurança para o caso de alguém acrescentar a tool à lista acima sem ler o porquê.
    const escritoras = tools.map((t) => t.name).filter((n) => VERBOS_DE_ESCRITA.test(n));
    expect(
      escritoras,
      `Tool com nome de escrita: ${escritoras.join(', ')}. Ver o comentário no topo deste arquivo.`,
    ).toEqual([]);
  });

  it('a lista declarada corresponde ao que o MCP realmente expõe — sem sobra nem falta', () => {
    // Sem isto a primeira asserção passaria por vacuidade se as tools sumissem: zero tools
    // desconhecidas é trivialmente verdadeiro quando não há tool alguma.
    expect(new Set(tools.map((t) => t.name))).toEqual(SOMENTE_LEITURA);
  });
});
