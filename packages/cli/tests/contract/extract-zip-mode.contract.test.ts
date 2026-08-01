import { execFile } from 'node:child_process';
import { mkdtemp, stat, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { extractZipTo } from '../../src/commands/extract-zip.js';

const execFileAsync = promisify(execFile);

/**
 * O bit de execução dos scripts precisa sobreviver à instalação.
 *
 * Medido em 2026-08-01, na jornada completa contra o registry no ar: o script publicado com
 * `-rwxrwxr-x` chegava ao disco do agente como `-rw-rw-r--`, e executá-lo dava permissão
 * negada. Uma skill `local` é **definida** por ter script — perder o bit a torna inútil pelo
 * único caminho que ela tem, e o sintoma aparece no agente, não na instalação.
 *
 * `createWriteStream` não aplica o modo gravado no zip; ele precisa ser restaurado
 * explicitamente a partir de `externalFileAttributes`.
 */
describe('extractZipTo preserva o modo dos arquivos', () => {
  it('um script executável no zip continua executável no destino', async () => {
    const origem = await mkdtemp(join(tmpdir(), 'zipmode-src-'));
    await writeFile(join(origem, 'rodar.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await chmod(join(origem, 'rodar.sh'), 0o755);
    await writeFile(join(origem, 'LEIA.md'), '# doc\n', 'utf8');

    // `zip` do sistema grava o modo em `externalFileAttributes` — é o formato real que um
    // publisher produz, não um zip sintético que já viesse com o campo do jeito conveniente.
    const zipPath = join(origem, 'p.zip');
    await execFileAsync('zip', ['-q', '-X', zipPath, 'rodar.sh', 'LEIA.md'], { cwd: origem });

    const destino = await mkdtemp(join(tmpdir(), 'zipmode-dst-'));
    await mkdir(destino, { recursive: true });
    const { readFile } = await import('node:fs/promises');
    await extractZipTo(await readFile(zipPath), destino);

    const script = await stat(join(destino, 'rodar.sh'));
    const doc = await stat(join(destino, 'LEIA.md'));

    expect(script.mode & 0o111, 'o script continua executável').not.toBe(0);
    expect(doc.mode & 0o111, 'e um arquivo comum NÃO ganha o bit — nada vira executável por acidente').toBe(0);
  });
});
