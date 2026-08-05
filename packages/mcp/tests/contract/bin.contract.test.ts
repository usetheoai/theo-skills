import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'bin.js');

/**
 * O BINÁRIO, executado como processo — não a fábrica que ele usa.
 *
 * O DoD do M25 diz "com o binário em processo separado, não um duplo". A metade "cliente
 * oficial" era verdade; esta não: 112 linhas de parsing de argumentos e de guardas
 * fail-closed sem um teste sequer. Um duplo em processo exercita a fábrica e passa por cima
 * de tudo o que só existe no executável — que é justamente onde um erro de configuração
 * aparece pela primeira vez, em produção.
 */

/**
 * A linha de erro do binário, isolada do resto do stderr.
 *
 * As asserções de "quem foi nomeado" olham SÓ esta linha. Asseverar sobre o buffer inteiro
 * reprovaria por uma linha de diagnóstico vizinha que mencione a variável por outro motivo
 * (`using THEOSKILL_REGISTRY=...`) — uma falha sem regressão de comportamento.
 */
function linhaDeErro(stderr: string): string {
  return stderr.split('\n').find((l) => l.startsWith('theo-skills mcp:')) ?? '';
}

/** Roda o binário e devolve código + stderr, sem lançar em código não-zero. */
async function rodar(
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
      env: { ...process.env, THEOSKILL_REGISTRY: '', THEOSKILL_AUTH: '', ...env },
      timeout: 10_000,
    });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? -1, stderr: e.stderr ?? '' };
  }
}

describe('bin — fail-closed no boot', () => {
  it('sem THEOSKILL_REGISTRY nem THEOSKILL_AUTH: sai 2 e DIZ o que falta', async () => {
    // Subir sem credencial daria um servidor que responde a tudo com erro de autenticação, e
    // o operador levaria muito mais tempo para descobrir por quê. A mensagem nomear as duas
    // variáveis é parte da correção, não zelo.
    const { code, stderr } = await rodar([]);
    expect(code).toBe(2);
    expect(stderr).toContain('THEOSKILL_REGISTRY');
    expect(stderr).toContain('THEOSKILL_AUTH');
  });

  it('com registry e SEM credencial no stdio: sai 2 nomeando só a que falta', async () => {
    // A asserção negativa cita o NOME DA VARIÁVEL, nunca a frase ao redor dele.
    //
    // Ela dizia `not.toContain('THEOSKILL_REGISTRY é obrigatório')`. Traduzir `bin.ts` — que é
    // o que a fase 3 deste plano faz — tornaria a asserção VACUAMENTE verdadeira: nada mais
    // poderia conter a frase em português, o teste seguiria verde, e o comportamento que ele
    // protege ("nomear só a variável que falta") deixaria de ser protegido em silêncio.
    //
    // O nome da variável de ambiente não se traduz. É por isso que a asserção passa a ser sobre
    // ele, e sobre a linha de erro isolada em vez do stderr inteiro.
    const { code, stderr } = await rodar([], { THEOSKILL_REGISTRY: 'http://reg.local' });
    const erro = linhaDeErro(stderr);

    expect(code).toBe(2);
    expect(erro).toContain('THEOSKILL_AUTH');
    expect(erro).not.toContain('THEOSKILL_REGISTRY');
  });

  it('a asserção olha a linha de erro, não o stderr inteiro', () => {
    // Sem este escopo, uma linha de diagnóstico vizinha citando a variável reprovaria o teste
    // acima sem que nada tivesse regredido.
    const stderr = [
      'debug: using THEOSKILL_REGISTRY=http://reg.local',
      'theo-skills mcp: THEOSKILL_AUTH é obrigatório — o servidor não sobe sem credencial.',
    ].join('\n');

    expect(linhaDeErro(stderr)).not.toContain('THEOSKILL_REGISTRY');
    expect(linhaDeErro(stderr)).toContain('THEOSKILL_AUTH');
  });

  it('transporte desconhecido: sai 2 e ecoa o valor recebido', async () => {
    const { code, stderr } = await rodar(['--transport', 'carruagem']);
    expect(code).toBe(2);
    expect(stderr).toContain('carruagem');
  });

  it('porta fora de faixa: sai 2', async () => {
    const { code } = await rodar(['--transport', 'streamable-http', '--port', '99999'], {
      THEOSKILL_REGISTRY: 'http://reg.local',
    });
    expect(code).toBe(2);
  });

  it('metade do TLS é recusada — só o certificado não sobe TLS', async () => {
    // Aceitar a metade daria um ouvinte em texto claro com aparência de configurado, que é
    // pior que um erro: ninguém vai auditar o que parece pronto.
    const { code, stderr } = await rodar(
      ['--transport', 'streamable-http', '--tls-cert', '/tmp/nao-existe.pem'],
      { THEOSKILL_REGISTRY: 'http://reg.local' },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--tls-key');
  });

  it('no transporte HTTP a credencial NÃO é exigida — o gateway a injeta por sessão', async () => {
    // No stdio o processo carrega uma chave fixa; aqui não. Exigir `THEOSKILL_AUTH` no HTTP
    // seria pior que inútil: fixaria todas as sessões num inquilino só, e o sintoma seria um
    // cliente lendo o catálogo de outro sem erro algum.
    //
    // Prova pela ausência do erro de boot: o processo NÃO sai por credencial faltando. Ele é
    // encerrado pelo timeout do execFile por continuar ouvindo — que é o comportamento certo.
    const { code, stderr } = await rodar(
      ['--transport', 'streamable-http', '--port', '0'],
      { THEOSKILL_REGISTRY: 'http://reg.local' },
    );
    expect(stderr).not.toContain('THEOSKILL_AUTH');
    expect(code, 'não sai por fail-closed de credencial').not.toBe(2);
  }, 20_000);
});

describe('bin — handshake real contra o PROCESSO, não contra a fábrica', () => {
  it('o binário lançado por spawn completa `initialize` e lista as ferramentas', async () => {
    // O DoD do M25 diz "com o binário em processo separado, não um duplo". Os casos acima
    // provam as guardas de boot; nenhum deles envia um frame JSON-RPC, então a metade
    // "handshake no binário" seguia sem cobertura — os handshakes viviam in-process.
    //
    // Aqui o cliente OFICIAL fala com o executável por stdio, exatamente como um agente que
    // hospeda um servidor MCP local.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    const client = new Client({ name: 'verificacao', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      env: { ...process.env, THEOSKILL_REGISTRY: 'http://registry.invalido', THEOSKILL_AUTH: 'tsk_de_teste' },
    });

    await client.connect(transport);
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_skill',
      'list_skill_revisions',
      'load_skill',
      'search_skills',
    ]);

    // E a garantia do item 4 do DoD, medida NO BINÁRIO: o inquilino nunca é parâmetro de
    // ferramenta. Ele vem da credencial do processo; se aparecesse aqui, o agente poderia
    // escolher de qual cliente ler.
    for (const t of tools) {
      const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props.filter((p) => /workspace|tenant|account/i.test(p)), `${t.name}`).toEqual([]);
    }

    await client.close();
  }, 30_000);
});

