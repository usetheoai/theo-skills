#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createHttpRegistry } from './http-registry.js';
import { createSkillsMcpServer } from './server.js';
import { connectStreamableHttp } from './transports/streamable-http.js';

/** Porta padrão do MCP do theo-skills — irmã da REST :18087. */
const DEFAULT_HTTP_PORT = 18097;
const DEFAULT_HTTP_HOST = '127.0.0.1';

const readFlag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

/**
 * O executável do servidor de descoberta (M25).
 *
 * DOIS TRANSPORTES, e nenhum substitui o outro.
 *
 * `--transport stdio` (padrão) é como um agente hospeda um servidor MCP **local**: ele lança
 * o processo e fala pelos descritores padrão, herdando o isolamento do processo que o lançou.
 * A credencial é única e vem do ambiente.
 *
 * `--transport streamable-http` é o modo **frontado pelo gateway** (`theo-traefik-mcp`, que
 * roteia `/mcp/*`). Ali a credencial NÃO vem do ambiente: o gateway cunha uma chave por
 * inquilino e a injeta como `Authorization: Bearer`, e o ouvinte liga um registry por sessão
 * a partir dela. Por isso `THEOSKILL_AUTH` é exigido só no stdio — no HTTP ele seria pior que
 * inútil: fixaria todas as sessões num inquilino só.
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
  const argv = process.argv.slice(2);
  const transporte = readFlag(argv, '--transport') ?? 'stdio';
  if (transporte !== 'stdio' && transporte !== 'streamable-http') {
    process.stderr.write(`theo-skills mcp: --transport aceita 'stdio' ou 'streamable-http', recebi '${transporte}'\n`);
    process.exit(2);
    return;
  }

  const baseUrl = (process.env['THEOSKILL_REGISTRY'] ?? '').trim();

  if (transporte === 'streamable-http') {
    if (baseUrl === '') {
      process.stderr.write('theo-skills mcp: THEOSKILL_REGISTRY é obrigatório — sem ele o registry aponta para lugar nenhum.\n');
      process.exit(2);
      return;
    }
    const host = readFlag(argv, '--host') ?? DEFAULT_HTTP_HOST;
    const port = Number(readFlag(argv, '--port') ?? DEFAULT_HTTP_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      process.stderr.write(`theo-skills mcp: --port inválido: '${String(readFlag(argv, '--port'))}'\n`);
      process.exit(2);
      return;
    }
    const certPath = readFlag(argv, '--tls-cert');
    const keyPath = readFlag(argv, '--tls-key');
    // Os dois juntos ou nenhum: só o certificado não sobe TLS, e aceitar a metade daria um
    // ouvinte em texto claro com aparência de configurado.
    if ((certPath === undefined) !== (keyPath === undefined)) {
      process.stderr.write('theo-skills mcp: --tls-cert e --tls-key vêm juntos ou nenhum dos dois.\n');
      process.exit(2);
      return;
    }
    const tls =
      certPath !== undefined && keyPath !== undefined
        ? { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') }
        : undefined;

    const handle = await connectStreamableHttp({ host, port, baseUrl, ...(tls !== undefined ? { tls } : {}) });
    process.stderr.write(
      `theo-skills mcp: ouvindo em ${tls !== undefined ? 'https' : 'http'}://${host}:${String(handle.port)} → ${baseUrl}\n`,
    );
    return;
  }

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
