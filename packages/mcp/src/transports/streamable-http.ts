/**
 * Transporte streamable-HTTP do servidor MCP do theo-skills (M25).
 *
 * POR QUE ELE EXISTE. O servidor só falava **stdio**, e stdio é como um agente hospeda um
 * servidor MCP *local* — ele lança o processo e fala pelos descritores padrão. O
 * `theo-traefik-mcp` fronta servidores MCP por **HTTP** (`/mcp/*`), então enquanto este
 * arquivo não existisse "registrar no gateway" não era uma decisão de produto pendente: era
 * trabalho não feito. Os dois transportes coexistem; nenhum substitui o outro.
 *
 * O CONTRATO QUE IMPORTA É O DE ISOLAMENTO. No Modelo B o gateway valida a chave do
 * consumidor, cunha uma chave **por inquilino** e a injeta adiante como
 * `Authorization: Bearer <chave-cunhada>`. Este ouvinte liga, portanto, um `RegistryPort`
 * **por sessão MCP** a partir daquele bearer — cada chamada de ferramenta fala com o registry
 * usando a chave do próprio inquilino. Um registry compartilhado entre sessões faria o
 * inquilino B ler o catálogo do inquilino A, e o sintoma seria resultado plausível, não erro:
 * ninguém revisa uma resposta que parece certa.
 *
 * CICLO DE VIDA DA SESSÃO (padrão canônico do SDK, com estado): `initialize` (sem id de
 * sessão) → lê o bearer → constrói registry + servidor + transporte com id novo → guarda;
 * requisições seguintes são roteadas por `Mcp-Session-Id`; a sessão morre no close.
 *
 * Espelha a forma do transporte do `theo-rag` (`packages/mcp/src/transports/streamable-http.ts`)
 * — Regra 9, não reinventar o que a casa já resolveu. A diferença é o que se liga por sessão:
 * lá um cliente REST, aqui a porta de registry.
 */
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { createHttpRegistry } from '../http-registry.js';
import { createSkillsMcpServer } from '../server.js';
import { type RegistryPort } from '../tools.js';

/** Hosts tratados como localhost pela guarda de "não-localhost exige TLS". */
const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const SESSION_HEADER = 'mcp-session-id';

/**
 * Teto do corpo aceito ANTES de autenticar. Quadros JSON-RPC do MCP são pequenos; o corte
 * existe para que um POST gigante e sem credencial não esgote a memória do ouvinte (CWE-400).
 */
const MAX_BODY_BYTES = 256 * 1024;

/** Teto de sessões concorrentes — cada uma segura um registry e um servidor. */
const MAX_SESSIONS = 1024;

class BodyTooLargeError extends Error {}

export interface StreamableHttpOptions {
  readonly port: number;
  readonly host: string;
  /** Base do registry REST para o `RegistryPort` de cada sessão. */
  readonly baseUrl?: string;
  /** Material TLS em PEM; presente, o ouvinte sobe em https. Obrigatório fora de localhost. */
  readonly tls?: { readonly cert: string; readonly key: string };
  /**
   * Fábrica do registry por sessão (DIP — substituível no teste). O padrão constrói um
   * cliente HTTP real atrelado ao bearer cunhado para aquele inquilino.
   */
  readonly buildRegistry?: (auth: string) => RegistryPort;
}

export interface StreamableHttpHandle {
  readonly host: string;
  readonly port: number;
  address(): AddressInfo | string | null;
  close(): Promise<void>;
}

/**
 * Recusa subir em host não-localhost sem TLS (fail-fast, Regra 8).
 *
 * Não é zelo: sem TLS o bearer cunhado por inquilino trafega em texto claro. Um aviso no log
 * seria lido uma vez e ignorado para sempre; a recusa não tem esse problema.
 */
export function assertNonLocalhostHasTls(host: string, hasTls: boolean): void {
  if (LOCALHOST_HOSTS.has(host) || hasTls) return;
  throw new Error(
    `connectStreamableHttp: recusando subir no host não-localhost "${host}" sem TLS. ` +
      `Passe tls: { cert, key } ou ligue em localhost.`,
  );
}

/** Extrai o token de um header Authorization; `undefined` quando ausente ou malformado. */
export function bearerFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const m = /^Bearer\s+(.+)$/.exec(header.trim());
  const tok = m?.[1];
  return tok !== undefined && tok.length > 0 ? tok : undefined;
}

/**
 * Lê o corpo inteiro (limitado) e faz o parse JSON; `undefined` se vazio ou ilegível.
 *
 * O corte é INCREMENTAL, checado a cada pedaço — bufferizar tudo para só então comparar o
 * tamanho é precisamente o que a guarda deveria impedir.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      // Não destrua o socket aqui: isso resetaria a conexão antes de o 413 sair.
      throw new BodyTooLargeError(`corpo excede ${String(MAX_BODY_BYTES)} bytes`);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  close(): Promise<void>;
}

const erroJson = (res: ServerResponse, status: number, code: number, message: string): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
};

/**
 * Sobe um ouvinte http/https servindo o MCP do theo-skills, com um `RegistryPort` por sessão
 * construído a partir do bearer da requisição. Devolve um handle para desligar limpo.
 */
export async function connectStreamableHttp(options: StreamableHttpOptions): Promise<StreamableHttpHandle> {
  // VAZIO É AUSENTE. `--tls-cert /dev/null` (ou um arquivo que não existe mais) faz a leitura
  // devolver string vazia; sem esta checagem a guarda abaixo vê `tls !== undefined`, aceita o
  // host público, e o ouvinte ANUNCIA `https` sobre material que não negocia. Encontrado
  // testando a imagem, não a suíte.
  if (options.tls !== undefined && (options.tls.cert.trim() === '' || options.tls.key.trim() === '')) {
    throw new Error('connectStreamableHttp: material TLS vazio — cert e key precisam ter conteúdo, não só existir.');
  }
  assertNonLocalhostHasTls(options.host, options.tls !== undefined);

  const baseUrl = options.baseUrl ?? '';
  const buildRegistry =
    options.buildRegistry ??
    ((auth: string): RegistryPort => {
      if (baseUrl === '') {
        // Fail-fast: sem base o registry apontaria para lugar nenhum e toda ferramenta
        // devolveria erro de rede — um sintoma que não diz a causa.
        throw new Error('connectStreamableHttp: baseUrl é obrigatório sem buildRegistry');
      }
      return createHttpRegistry({ baseUrl, auth });
    });

  const sessions = new Map<string, Session>();

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    void (async (): Promise<void> => {
      try {
        const sessionId = req.headers[SESSION_HEADER];
        if (typeof sessionId === 'string') {
          const sessao = sessions.get(sessionId);
          if (sessao !== undefined) {
            await sessao.transport.handleRequest(req, res);
            return;
          }
        }

        // Limite a tabela ANTES de bufferizar o corpo de uma sessão nova.
        if (sessions.size >= MAX_SESSIONS) {
          erroJson(res, 503, -32003, 'Service Unavailable: limite de sessões atingido');
          return;
        }

        const body = await readJsonBody(req);
        if (!isInitializeRequest(body)) {
          erroJson(res, 400, -32000, 'Bad Request: sem id de sessão válido');
          return;
        }

        const auth = bearerFrom(req.headers.authorization);
        if (auth === undefined) {
          erroJson(res, 401, -32001, 'Unauthorized: bearer ausente');
          return;
        }

        const server = createSkillsMcpServer({ registry: buildRegistry(auth) });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string): void => {
            sessions.set(sid, {
              transport,
              close: async (): Promise<void> => {
                await server.close();
              },
            });
          },
        });
        transport.onclose = (): void => {
          if (transport.sessionId !== undefined) {
            const s = sessions.get(transport.sessionId);
            sessions.delete(transport.sessionId);
            void s?.close();
          }
        };
        // O SDK declara `onclose` como `(() => void) | undefined`, que não satisfaz
        // `onclose?: () => void` da interface Transport sob `exactOptionalPropertyTypes`.
        // Conversão estrutural restrita a esta fronteira de interoperabilidade.
        await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
        await transport.handleRequest(req, res, body);
      } catch (err: unknown) {
        if (err instanceof BodyTooLargeError) {
          if (!res.headersSent) erroJson(res, 413, -32002, 'Payload Too Large');
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[theo-skills-mcp] erro de transporte: ${message}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error\n');
        }
      }
    })();
  };

  const httpServer: HttpServer | HttpsServer =
    options.tls !== undefined
      ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, handler)
      : createHttpServer(handler);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const resolvedPort = typeof addr === 'object' && addr !== null ? addr.port : options.port;

  return {
    host: options.host,
    port: resolvedPort,
    address: () => httpServer.address(),
    close: async (): Promise<void> => {
      for (const s of sessions.values()) await s.close();
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
