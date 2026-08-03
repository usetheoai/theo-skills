import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import yauzl from 'yauzl';

import { packageSkill } from '../../src/zip.js';

/**
 * O empacotador precisa GRAVAR o bit de execução no zip.
 *
 * Aqui é a origem do defeito medido em 2026-08-01: `addBuffer` sem `mode` grava
 * `externalFileAttributes = 0`, então nem o extrator mais correto tem o que restaurar. Uma
 * skill `local` é definida por ter script; publicá-la sem o bit entrega ao agente um arquivo
 * que ele é instruído a executar e não consegue.
 *
 * O teste lê o campo REAL do zip produzido — não o disco, que é onde o defeito não aparece.
 */
const modosDoZip = (buf: Buffer): Promise<Record<string, number>> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zf) => {
      if (err !== null || zf === undefined) return reject(err ?? new Error('zip ilegível'));
      const out: Record<string, number> = {};
      zf.on('entry', (e: yauzl.Entry) => {
        out[e.fileName] = (e.externalFileAttributes >>> 16) & 0o777;
        zf.readEntry();
      });
      zf.on('end', () => resolve(out));
      zf.on('error', reject);
      zf.readEntry();
    });
  });

describe('packageSkill grava o modo dos arquivos', () => {
  it('script executável entra no zip COM o bit; arquivo comum entra SEM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pack-mode-'));
    await writeFile(join(dir, 'SKILL.md'), '# s\n', 'utf8');
    await writeFile(join(dir, 'rodar.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await chmod(join(dir, 'rodar.sh'), 0o755);

    const modos = await modosDoZip(await packageSkill(dir));

    expect(modos['rodar.sh']! & 0o111, 'o bit chega ao zip').not.toBe(0);
    expect(modos['SKILL.md']! & 0o111, 'e nada vira executável por acidente').toBe(0);
  });
});
