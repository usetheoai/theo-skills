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
    const { code, stderr } = await rodar([], { THEOSKILL_REGISTRY: 'http://reg.local' });
    expect(code).toBe(2);
    expect(stderr).toContain('THEOSKILL_AUTH');
    expect(stderr).not.toContain('THEOSKILL_REGISTRY é obrigatório');
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
