#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createHttpRegistry } from './http-registry.js';
import { createSkillsMcpServer } from './server.js';

/**
 * O executável do servidor de descoberta (M25).
 *
 * Transporte **stdio**: é como um agente hospeda um servidor MCP local — ele lança o
 * processo e fala pelos descritores padrão. Um transporte HTTP exigiria porta, TLS e um
 * modelo de autenticação próprio; stdio herda o isolamento do processo que o lançou, que é
 * exatamente o que se quer quando o servidor carrega uma credencial.
 *
 * A CREDENCIAL VEM DO AMBIENTE, NUNCA DE ARGUMENTO. Linha de comando aparece em `ps`, em
 * histórico de shell e em log de supervisor; variável de ambiente não. E é ela que fixa o
 * cliente: o agente não tem como influenciá-lo, porque não é parâmetro de ferramenta alguma.
 *
 * FAIL-CLOSED no boot. Sem `THEOSKILL_REGISTRY` ou sem `THEOSKILL_AUTH` o processo sai com
 * código 2 e diz o que falta. Subir sem credencial daria um servidor que responde a tudo com
 * erro de autenticação — e o operador levaria muito mais tempo para descobrir por quê.
 */
async function main(): Promise<void> {
  const baseUrl = (process.env['THEOSKILL_REGISTRY'] ?? '').trim();
  const auth = (process.env['THEOSKILL_AUTH'] ?? '').trim();

  if (baseUrl === '' || auth === '') {
    const faltando = [baseUrl === '' ? 'THEOSKILL_REGISTRY' : '', auth === '' ? 'THEOSKILL_AUTH' : '']
      .filter((v) => v !== '')
      .join(' e ');
    process.stderr.write(
      `theo-skills mcp: ${faltando} é obrigatório — o servidor não sobe sem saber contra qual registry ` +
        `falar e com qual credencial. A credencial vem do AMBIENTE, nunca de argumento de linha de comando.\n`,
    );
    process.exit(2);
    return;
  }

  const server = createSkillsMcpServer({ registry: createHttpRegistry({ baseUrl, auth }) });
  await server.connect(new StdioServerTransport());

  // NADA em stdout além do protocolo. Um `console.log` aqui corromperia o fluxo JSON-RPC e o
  // agente veria uma falha de parse sem relação aparente com a causa.
  process.stderr.write(`theo-skills mcp: ligado a ${baseUrl}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`theo-skills mcp: falha ao subir: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
