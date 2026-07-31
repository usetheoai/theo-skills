import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
