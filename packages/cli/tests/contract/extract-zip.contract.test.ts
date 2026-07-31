import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import yazl from 'yazl';

import { extractZipTo } from '../../src/commands/extract-zip.js';

/** Constrói um zip real em memória — nada de mock: o risco aqui é do formato. */
function zipWith(entries: readonly (readonly [string, string])[]): Promise<Buffer> {
  const z = new yazl.ZipFile();
  for (const [name, content] of entries) z.addBuffer(Buffer.from(content, 'utf8'), name);
  z.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    z.outputStream.on('error', reject);
  });
}

const tmp = () => mkdtemp(join(tmpdir(), 'skzip-'));

/**
 * Forja um zip com caminho malicioso.
 *
 * O `yazl` RECUSA criar um zip assim (`invalid relative path`) — e está certo. Mas um
 * atacante não usa yazl: ele monta os bytes. Geramos com um nome benigno do MESMO
 * comprimento e trocamos os bytes do nome, que é exatamente o artefato que chegaria pela
 * rede. Testar só com zips bem-comportados provaria que a guarda funciona onde ela nunca
 * seria necessária.
 */
async function zipForjado(benigno: string, malicioso: string, conteudo: string): Promise<Buffer> {
  if (benigno.length !== malicioso.length) throw new Error('os nomes precisam ter o mesmo comprimento');
  const buf = await zipWith([[benigno, conteudo]]);
  // O nome aparece duas vezes: no local file header e no central directory.
  let out = buf;
  let idx = out.indexOf(benigno, 0, 'utf8');
  while (idx !== -1) {
    out = Buffer.concat([out.subarray(0, idx), Buffer.from(malicioso, 'utf8'), out.subarray(idx + benigno.length)]);
    idx = out.indexOf(benigno, idx + malicioso.length, 'utf8');
  }
  return out;
}

describe('extractZipTo', () => {
  it('extrai arquivos e subdiretórios preservando o conteúdo', async () => {
    const dest = await tmp();
    await extractZipTo(await zipWith([['SKILL.md', '# skill'], ['scripts/run.sh', 'echo oi']]), dest);
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toBe('# skill');
    expect(await readFile(join(dest, 'scripts', 'run.sh'), 'utf8')).toBe('echo oi');
  });

  it('ZIP-SLIP: entrada que escapa do destino é RECUSADA', async () => {
    // Risco distinto do nome da skill: mesmo com um nome legítimo, uma ENTRADA do zip pode
    // chamar-se `../../.ssh/authorized_keys`. Quem controla o zip é quem publicou a skill —
    // um terceiro. É o modo clássico de um instalador virar escrita arbitrária no disco.
    //
    // DUAS CAMADAS, e o teste aceita qualquer uma: o próprio `yauzl` valida caminho relativo
    // (`invalid relative path`) e rejeita antes de a nossa guarda ser alcançada. Manter a
    // guarda mesmo assim não é redundância decorativa — ela é o que sobra se a validação da
    // biblioteca mudar, for desligada por opção, ou se o leitor for trocado. Afirmar aqui
    // que a mensagem é a NOSSA seria descrever um caminho que hoje não é exercitado.
    const dest = await tmp();
    const forjado = await zipForjado('aa/fora.txt', '../fora.txt', 'malicioso');
    await expect(extractZipTo(forjado, dest)).rejects.toThrow(/escaparia|invalid relative path/);
    expect(await readdir(dest), 'zip malicioso deixou arquivo no destino').toEqual([]);
  });

  it('ZIP-SLIP com travessia profunda também é recusado', async () => {
    const dest = await tmp();
    const forjado = await zipForjado('a/b/cc/dd/ee/ff/x.txt', 'a/b/../../../../x.txt', 'x');
    await expect(extractZipTo(forjado, dest)).rejects.toThrow(/escaparia|invalid relative path/);
    expect(await readdir(dest)).toEqual([]);
  });

  it('zip vazio deixa o diretório criado e vazio (o chamador grava a proveniência nele)', async () => {
    const dest = await tmp();
    await extractZipTo(await zipWith([]), dest);
    expect(await readdir(dest)).toEqual([]);
  });

  it('buffer que não é zip rejeita com erro, sem deixar lixo', async () => {
    const dest = await tmp();
    await expect(extractZipTo(Buffer.from('isto não é um zip'), dest)).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
  });
});
