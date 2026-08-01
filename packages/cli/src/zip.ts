import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';

import yazl from 'yazl';

/**
 * Recursively collect REGULAR file paths under `dir`. Symlinks are intentionally
 * skipped (a Dirent for a symlink is neither isFile nor isDirectory), so a
 * malicious `ln -s /etc/passwd` inside a skill dir is never packaged or uploaded
 * — the walk cannot escape `dir`. The server's yauzl `symlink` guard is the
 * second line of defence on ingest.
 */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
    // symlinks (and other special entries) are deliberately omitted — see docstring.
  }
  return out;
}

/**
 * Package a skill directory (or a single SKILL.md / .zip file) into the zip
 * payload the registry expects. A directory is zipped with paths relative to it
 * (forward slashes); a `.zip` is read as-is; any other file is zipped at its
 * basename so a lone `SKILL.md` works.
 */
export async function packageSkill(path: string): Promise<Buffer> {
  const st = await stat(path);
  if (st.isFile()) {
    if (path.endsWith('.zip')) {
      return readFile(path);
    }
    const name = path.split(sep).pop() ?? 'SKILL.md';
    return zipEntries([{ name, content: await readFile(path) }]);
  }
  const files = await walk(path);
  const entries = await Promise.all(
    files.map(async (f) => ({
      name: relative(path, f).split(sep).join(posix.sep),
      content: await readFile(f),
      mode: (await stat(f)).mode,
    })),
  );
  return zipEntries(entries);
}

function zipEntries(
  entries: readonly { name: string; content: Buffer; mode?: number }[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const e of entries) {
      // O MODO PRECISA ENTRAR NO ZIP. `addBuffer` sem `mode` grava
      // `externalFileAttributes = 0`, e aí nem o extrator mais correto tem o que restaurar:
      // um script publicado com 755 chega ao disco do agente como 644, e ele recebe
      // "permissão negada" ao seguir a própria instrução da skill. Medido em 2026-08-01, na
      // jornada completa contra o registry no ar.
      //
      // Só o bit de execução viaja, e só quando existe na origem. Propagar o modo inteiro
      // deixaria um zip de terceiro carregar `setuid`/`setgid` para o disco de quem instala.
      const exec = ((e.mode ?? 0) & 0o111) !== 0;
      zip.addBuffer(e.content, e.name, exec ? { mode: 0o100755 } : {});
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
