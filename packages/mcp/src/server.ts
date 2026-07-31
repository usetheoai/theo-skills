import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { createSkillTools, type RegistryPort } from './tools.js';

export interface SkillsMcpServerOptions {
  readonly registry: RegistryPort;
  /** Sobrescreve o nome anunciado no handshake. Só para teste. */
  readonly name?: string;
  readonly version?: string;
}

/**
 * O SERVIDOR de descoberta do theo-skills (M25).
 *
 * O QUE ISTO CORRIGE. Este pacote se descrevia como "Servidor MCP do theo-skills" e **não
 * continha servidor**: `tools.ts` e `http-registry.ts` são descritores e um cliente HTTP —
 * úteis, e inalcançáveis. Sem `bin`, sem transporte e sem a dependência de MCP, nenhum
 * agente conseguia conectar. A descoberta existia como biblioteca que só o próprio
 * repositório conseguia chamar.
 *
 * A SUPERFÍCIE, e por que ela é desenhada assim. Uma ferramenta MCP é invocada por um
 * **agente**, com argumentos que ele compõe a partir de texto que pode vir de qualquer
 * lugar. Daí a regra que atravessa o arquivo inteiro: **o cliente nunca é argumento**. Ele
 * vem da credencial com que este servidor foi construído, e o agente não tem como
 * influenciá-lo. Se `workspace_id` fosse parâmetro, bastaria uma instrução injetada num
 * documento lido pelo agente para atravessar o isolamento.
 *
 * ERRO NUNCA É SILÊNCIO. Uma falha do registry vira erro de ferramenta, não lista vazia:
 * `[]` diante de um servidor fora do ar diz ao agente "nenhuma skill", quando a verdade é
 * "não consegui perguntar" — e ele segue a tarefa com essa conclusão, que é a pior resposta
 * possível justamente por ser plausível.
 */
export function createSkillsMcpServer(opts: SkillsMcpServerOptions): Server {
  const tools = createSkillTools(opts.registry);
  const porNome = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: opts.name ?? 'theo-skills', version: opts.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = porNome.get(req.params.name);
    if (tool === undefined) {
      return { content: [{ type: 'text' as const, text: `ferramenta desconhecida: ${req.params.name}` }], isError: true };
    }
    try {
      const resultado = await tool.invoke(req.params.arguments ?? {});
      // Uma ferramenta pode recusar por argumento inválido devolvendo `{error}` — isso é
      // erro de ferramenta, não sucesso com corpo estranho. Sem esta tradução o agente
      // receberia `{"error":"..."}` como se fosse resultado e seguiria em frente.
      const ehErro =
        typeof resultado === 'object' && resultado !== null && 'error' in (resultado as Record<string, unknown>);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resultado) }],
        ...(ehErro ? { isError: true } : {}),
      };
    } catch (err) {
      // A falha PROPAGA como erro de ferramenta. Nunca `[]`: silêncio aqui vira decisão
      // errada do agente, e uma decisão plausível não é revisada por ninguém.
      return {
        content: [
          {
            type: 'text',
            text: `registry indisponível: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
