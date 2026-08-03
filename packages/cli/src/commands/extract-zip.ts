import { createWriteStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import yauzl from 'yauzl';

/**
 * Extrai um zip para `destDir` (M18).
 *
 * `yauzl` já é dependência do produto — é o que o validador de payload usa no servidor.
 * Reusar em vez de adicionar uma segunda biblioteca de zip é a rung 4 da parsimony ladder.
 *
 * **Zip-slip é o risco real aqui**, e ele é distinto do path traversal do `name`: mesmo com
 * um nome de skill legítimo, uma ENTRADA do zip pode chamar-se `../../.ssh/authorized_keys`.
 * Quem controla o zip é quem publicou a skill — um terceiro. Cada entrada é resolvida e
 * recusada se escapar do destino.
 */
/**
 * Restaura o bit de execução gravado no zip.
 *
 * `createWriteStream` cria o arquivo com o modo padrão do processo e IGNORA o que o zip diz —
 * então um script publicado com `755` chegava ao disco do agente como `644`. Uma skill `local`
 * é **definida** por ter script: perder o bit a torna inútil pelo único caminho que ela tem, e
 * o sintoma ("permissão negada") aparece no agente, não na instalação. Medido em 2026-08-01 na
 * jornada completa contra o registry no ar.
 *
 * SÓ o bit de execução é restaurado, e só quando o zip o declara. Não copiamos o modo inteiro:
 * um zip de terceiro poderia trazer `setuid`, `setgid` ou permissão de escrita para todos, e
 * aplicar isso cegamente daria a quem publica uma skill controle sobre o disco de quem instala.
 * `0o111` mascarado contra o umask preserva o que importa e nada além.
 */
async function aplicarModo(target: string, entry: yauzl.Entry): Promise<void> {
  // O modo Unix vive nos 16 bits altos de `externalFileAttributes`. Zero = zip criado por
  // ferramenta que não grava modo (Windows, por exemplo); nesse caso não há o que restaurar.
  const modo = (entry.externalFileAttributes >>> 16) & 0o777;
  if (modo === 0 || (modo & 0o111) === 0) return;
  const atual = (await stat(target)).mode & 0o777;
  await chmod(target, atual | (modo & 0o111));
}

export async function extractZipTo(zip: Buffer, destDir: string): Promise<void> {
  const root = resolve(destDir);

  await new Promise<void>((resolvePromise, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err !== null || zipfile === undefined) {
        reject(err ?? new Error('zip ilegível'));
        return;
      }

      zipfile.on('error', reject);
      zipfile.on('end', () => {
        resolvePromise();
      });

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const target = resolve(root, normalize(entry.fileName));
        if (target !== root && !target.startsWith(root + sep)) {
          reject(new Error(`entrada de zip escaparia do destino: ${entry.fileName}`));
          return;
        }

        // Diretório: cria e segue.
        if (entry.fileName.endsWith('/')) {
          mkdir(target, { recursive: true })
            .then(() => {
              zipfile.readEntry();
            })
            .catch(reject);
          return;
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr !== null || readStream === undefined) {
            reject(streamErr ?? new Error(`falha ao ler ${entry.fileName}`));
            return;
          }
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(readStream, createWriteStream(target)))
            .then(() => aplicarModo(target, entry))
            .then(() => {
              zipfile.readEntry();
            })
            .catch(reject);
        });
      });

      zipfile.readEntry();
    });
  });

  // Garante que o diretório exista mesmo para um zip vazio — o chamador grava a
  // proveniência dentro dele logo em seguida.
  await mkdir(join(root), { recursive: true });
}
