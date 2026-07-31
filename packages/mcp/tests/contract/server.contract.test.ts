import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createSkillsMcpServer } from '../../src/server.js';
import { type RegistryPort } from '../../src/tools.js';

/**
 * M25 — o SERVIDOR de descoberta, não a biblioteca de descritores.
 *
 * O pacote se descrevia como "Servidor MCP" e **não continha servidor**: sem `bin`, sem
 * transporte, sem dependência de MCP. Nenhum agente conseguia conectar. Estes testes falam
 * com ele pelo **cliente MCP oficial**, sobre um transporte real — um teste que só chamasse
 * as funções internas provaria a biblioteca de novo, que é exatamente o que já existia.
 */

const registry = (over: Partial<RegistryPort> = {}): RegistryPort => ({
  retrieve: () =>
    Promise.resolve([
      { skill_id: 'guia', name: 'guia', description: 'orienta', category: 'Sales', execution: 'remote' },
    ]),
  get: () => Promise.resolve({ skill_id: 'guia', name: 'guia', description: 'orienta' }),
  revisions: () => Promise.resolve([{ revision_id: 'rev_1', version: '1.0.0' }]),
  instructions: () =>
    Promise.resolve({ skill_id: 'guia', instructions: '# Passos', execution: 'remote', origin: 'own' }),
  ...over,
});

async function conectar(port: RegistryPort = registry()) {
  const [aoCliente, aoServidor] = InMemoryTransport.createLinkedPair();
  const server = createSkillsMcpServer({ registry: port });
  const client = new Client({ name: 'teste', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(aoServidor), client.connect(aoCliente)]);
  return { client, server };
}

describe('servidor MCP do theo-skills', () => {
  it('completa o HANDSHAKE — é isto que separa servidor de biblioteca', async () => {
    const { client, server } = await conectar();
    expect(client.getServerVersion()?.name).toBe('theo-skills');
    await server.close();
  });

  it('lista as ferramentas pelo protocolo', async () => {
    const { client, server } = await conectar();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_skill', 'list_skill_revisions', 'load_skill', 'search_skills']);
    await server.close();
  });

  it('NENHUMA ferramenta aceita o cliente como argumento', async () => {
    // A garantia central: um agente compõe argumentos a partir de texto que pode conter
    // instrução injetada. "Busque no workspace da empresa X" atravessaria o isolamento se o
    // cliente viesse dali. Ele vem da credencial do servidor, fixado na construção.
    const { client, server } = await conectar();
    const { tools } = await client.listTools();
    for (const t of tools) {
      const props = Object.keys((t.inputSchema as { properties?: object }).properties ?? {});
      expect(props.join(' '), `ferramenta ${t.name}`).not.toMatch(/workspace|tenant|account/i);
    }
    await server.close();
  });

  it('busca devolve categoria e modo de execução — o agente decide sem segunda chamada', async () => {
    const { client, server } = await conectar();
    const r = await client.callTool({ name: 'search_skills', arguments: { query: 'guia', top_k: 3 } });
    const texto = JSON.stringify(r.content);
    expect(texto).toContain('Sales');
    expect(texto).toContain('remote');
    await server.close();
  });

  it('busca aceita filtro por categoria', async () => {
    let recebido: string | undefined;
    const { client, server } = await conectar(
      registry({
        // Sem cast: a porta já declara o terceiro parâmetro, e uma asserção aqui
        // esconderia uma futura divergência de assinatura em vez de acusá-la.
        retrieve: (_q: string, _k: number, cat?: string) => {
          recebido = cat;
          return Promise.resolve([]);
        },
      }),
    );
    await client.callTool({ name: 'search_skills', arguments: { query: 'x', category: 'Shop' } });
    expect(recebido).toBe('Shop');
    await server.close();
  });

  it('`load_skill` carrega o corpo — a segunda fase, pelo protocolo', async () => {
    const { client, server } = await conectar();
    const r = await client.callTool({ name: 'load_skill', arguments: { skill_id: 'guia' } });
    expect(JSON.stringify(r.content)).toContain('# Passos');
    await server.close();
  });

  it('falha do registry vira ERRO de ferramenta, nunca resposta vazia', async () => {
    // `[]` diante de um registry fora do ar diz ao agente "nenhuma skill", quando a verdade
    // é "não consegui perguntar" — e ele segue a tarefa com essa conclusão, que é a pior
    // resposta possível porque é plausível.
    const { client, server } = await conectar(
      registry({ retrieve: () => Promise.reject(new Error('registry fora')) }),
    );
    const r = await client.callTool({ name: 'search_skills', arguments: { query: 'x' } });
    expect(r.isError, 'silêncio aqui vira decisão errada do agente').toBe(true);
    await server.close();
  });

  it('argumento inválido é erro de ferramenta com mensagem útil', async () => {
    const { client, server } = await conectar();
    const r = await client.callTool({ name: 'search_skills', arguments: { query: '' } });
    expect(r.isError).toBe(true);
    await server.close();
  });
});
