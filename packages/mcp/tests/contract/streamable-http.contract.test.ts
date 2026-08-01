import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';

import { type RegistryPort } from '../../src/tools.js';
import {
  assertNonLocalhostHasTls,
  bearerFrom,
  connectStreamableHttp,
  type StreamableHttpHandle,
} from '../../src/transports/streamable-http.js';

/**
 * M25 — o transporte que faltava.
 *
 * O servidor MCP do theo-skills só falava **stdio**, e o `theo-traefik-mcp` fronta servidores
 * MCP por **HTTP** (`/mcp/*`). Enquanto o transporte não existisse, "registrar no gateway" não
 * era decisão de produto pendente: era trabalho não feito. Este arquivo é o RED disso.
 *
 * O contrato que importa é o de ISOLAMENTO: o gateway valida a chave do consumidor, cunha uma
 * chave POR INQUILINO e a injeta como `Authorization: Bearer`. O ouvinte precisa, então, ligar
 * um `RegistryPort` **por sessão** a partir daquele bearer — um registry compartilhado entre
 * sessões faria o inquilino B ler o catálogo do inquilino A, e o sintoma seria resultado
 * plausível, não erro.
 */

const registryVazio: RegistryPort = {
  retrieve: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  revisions: () => Promise.resolve([]),
  instructions: () => Promise.resolve(null),
};

async function conectar(url: string, bearer: string): Promise<Client> {
  const client = new Client({ name: 'teste', version: '0.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
  });
  // O transporte-cliente do SDK declara `sessionId: string | undefined`, que não satisfaz
  // `Transport` sob `exactOptionalPropertyTypes`. Conversão restrita a esta fronteira de
  // interoperabilidade — os nossos próprios tipos seguem estritos.
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  return client;
}

describe('assertNonLocalhostHasTls', () => {
  it('aceita localhost sem TLS', () => {
    expect(() => assertNonLocalhostHasTls('127.0.0.1', false)).not.toThrow();
  });

  it('RECUSA host não-localhost sem TLS — fail-fast, não aviso', () => {
    // Subir em 0.0.0.0 sem TLS publica credencial de inquilino em texto claro na rede.
    // Um aviso seria lido uma vez e ignorado para sempre; a recusa não tem esse problema.
    expect(() => assertNonLocalhostHasTls('0.0.0.0', false)).toThrow(/TLS/);
  });

  it('aceita não-localhost COM TLS', () => {
    expect(() => assertNonLocalhostHasTls('0.0.0.0', true)).not.toThrow();
  });
});

describe('material TLS vazio', () => {
  it('RECUSA cert/key vazios — a guarda de não-localhost não pode ser satisfeita com nada', async () => {
    // Encontrado testando a imagem: `--tls-cert /dev/null` faz `readFileSync` devolver string
    // vazia, a guarda vê `tls !== undefined` e o ouvinte ANUNCIA `https` sobre material que não
    // negocia. É a família de sempre — parece configurado, não é. Vazio é ausente.
    await expect(
      connectStreamableHttp({ host: '0.0.0.0', port: 0, buildRegistry: () => registryVazio, tls: { cert: '', key: '' } }),
    ).rejects.toThrow(/TLS/);
  });
});

describe('bearerFrom', () => {
  it('extrai o token', () => {
    expect(bearerFrom('Bearer tsk_abc')).toBe('tsk_abc');
  });

  it('é undefined quando ausente ou malformado', () => {
    expect(bearerFrom(undefined)).toBeUndefined();
    expect(bearerFrom('tsk_sem_esquema')).toBeUndefined();
    expect(bearerFrom('Bearer ')).toBeUndefined();
  });
});

describe('connectStreamableHttp', () => {
  let handle: StreamableHttpHandle | undefined;
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('serve uma sessão MCP e expõe as ferramentas de descoberta', async () => {
    handle = await connectStreamableHttp({ host: '127.0.0.1', port: 0, buildRegistry: () => registryVazio });

    const client = await conectar(`http://127.0.0.1:${String(handle.port)}/`, 'tsk_inquilino1');
    const nomes = (await client.listTools()).tools.map((t) => t.name).sort();

    expect(nomes).toEqual(['get_skill', 'list_skill_revisions', 'load_skill', 'search_skills']);
    await client.close();
  });

  it('liga um registry DISTINTO por sessão — dois inquilinos, duas chaves', async () => {
    // O teste central de isolamento. Se o ouvinte construísse um registry só, os dois
    // inquilinos leriam o mesmo catálogo e nenhum erro apareceria.
    const chaves: string[] = [];
    handle = await connectStreamableHttp({
      host: '127.0.0.1',
      port: 0,
      buildRegistry: (auth) => {
        chaves.push(auth);
        return registryVazio;
      },
    });

    const url = `http://127.0.0.1:${String(handle.port)}/`;
    const a = await conectar(url, 'tsk_inquilino_a');
    const b = await conectar(url, 'tsk_inquilino_b');
    await a.listTools();
    await b.listTools();

    expect(chaves).toEqual(['tsk_inquilino_a', 'tsk_inquilino_b']);
    await a.close();
    await b.close();
  });

  it('recusa initialize SEM bearer com 401 — fail-closed', async () => {
    handle = await connectStreamableHttp({ host: '127.0.0.1', port: 0, buildRegistry: () => registryVazio });

    const res = await fetch(`http://127.0.0.1:${String(handle.port)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });

    expect(res.status).toBe(401);
  });

  it('recusa corpo gigante ANTES de autenticar com 413 — guarda de exaustão de memória', async () => {
    // O corte é incremental e pré-auth de propósito: bufferizar 50 MB para só então
    // descobrir que não há credencial é o caminho fácil para derrubar o ouvinte.
    handle = await connectStreamableHttp({ host: '127.0.0.1', port: 0, buildRegistry: () => registryVazio });

    const res = await fetch(`http://127.0.0.1:${String(handle.port)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { pad: 'x'.repeat(300 * 1024) } }),
    });

    expect(res.status).toBe(413);
  });

  it('recusa requisição sem sessão que não seja initialize com 400', async () => {
    handle = await connectStreamableHttp({ host: '127.0.0.1', port: 0, buildRegistry: () => registryVazio });

    const res = await fetch(`http://127.0.0.1:${String(handle.port)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(res.status).toBe(400);
  });
});
