import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROVENANCE_FILE } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';

/** M19 DoD #4 — `update` respeita a procedência e MOSTRA antes de sobrescrever. */

const ZIP = Buffer.from('novo-conteudo');
const HASH = createHash('sha256').update(ZIP).digest('hex');

const tmp = () => mkdtemp(join(tmpdir(), 'skupd-'));

async function instalada(root: string, nome: string, prov: Record<string, string>): Promise<string> {
  const dir = join(root, nome);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), 'antigo', 'utf8');
  await writeFile(join(dir, PROVENANCE_FILE), JSON.stringify(prov), 'utf8');
  return dir;
}

// Espelha a API REAL: metadado SEM bytes, e os bytes na rota `…/payload`. O duplo anterior
// devolvia `payload_base64` no metadado — campo que o servidor nunca produziu (ver o
// comentário longo em `install.contract.test.ts`).
const fetchOf = (latest: string, version?: string) =>
  ((url: string) => {
    if (url.endsWith('/payload')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(ZIP.buffer.slice(ZIP.byteOffset, ZIP.byteOffset + ZIP.byteLength)),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          url.includes('/revisions/')
            ? { revision_id: latest, skill_id: 'sk_1', content_hash: HASH, version }
            : { skill_id: 'sk_1', name: 'minha-skill', latest_revision_id: latest },
        ),
    });
  }) as unknown as typeof globalThis.fetch;

const extractStub = async (zip: Buffer, dest: string): Promise<void> => {
  await writeFile(join(dest, 'SKILL.md'), zip.toString('utf8'), 'utf8');
};

const provBase = {
  registry: 'https://reg-origem.test',
  skill_id: 'sk_1',
  revision_id: 'rev_1',
  content_hash: 'h1',
  installed_at: '2026-01-01T00:00:00.000Z',
};

describe('runUpdate', () => {
  it('MOSTRA o diff e NÃO altera nada sem --apply', async () => {
    // Uma skill é instrução executável para um agente. Sobrescrever sem que ninguém veja o
    // que mudou é atualizar produção às cegas.
    const root = await tmp();
    const dir = await instalada(root, 'minha-skill', provBase);
    const lines: string[] = [];

    const code = await runUpdate('minha-skill', {
      out: (l) => lines.push(l),
      fetch: fetchOf('rev_2', '2.0.0'),
      registry: 'ignorado',
      skillsDir: root,
      extract: extractStub,
    });

    expect(code).toBe(0);
    const saida = lines.join('\n');
    expect(saida).toContain('rev_1 → rev_2');
    expect(saida).toContain('2.0.0');
    expect(saida).toContain('--apply');
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8'), 'alterou sem --apply').toBe('antigo');
  });

  it('com --apply substitui o conteúdo e atualiza a procedência', async () => {
    const root = await tmp();
    const dir = await instalada(root, 'minha-skill', provBase);
    const code = await runUpdate('minha-skill', {
      out: () => undefined,
      fetch: fetchOf('rev_2', '2.0.0'),
      registry: 'ignorado',
      skillsDir: root,
      extract: extractStub,
      apply: true,
      now: () => new Date('2026-07-31T00:00:00Z'),
    });
    expect(code).toBe(0);
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('novo-conteudo');
    const prov = JSON.parse(await readFile(join(dir, PROVENANCE_FILE), 'utf8')) as Record<string, string>;
    expect(prov['revision_id']).toBe('rev_2');
    expect(prov['installed_at']).toBe('2026-07-31T00:00:00.000Z');
  });

  it('usa o REGISTRY DA PROCEDÊNCIA, não o configurado agora', async () => {
    // Atualizar de outro registry seria troca silenciosa de fornecedor sobre uma skill que o
    // usuário confiou a alguém específico.
    const root = await tmp();
    await instalada(root, 'minha-skill', provBase);
    const urls: string[] = [];
    const spyFetch = ((url: string) => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ skill_id: 'sk_1', name: 'minha-skill', latest_revision_id: 'rev_1' }),
      });
    }) as unknown as typeof globalThis.fetch;

    await runUpdate('minha-skill', {
      out: () => undefined,
      fetch: spyFetch,
      registry: 'https://outro-registry.test',
      skillsDir: root,
      extract: extractStub,
    });
    expect(urls[0]).toContain('reg-origem.test');
    expect(urls.join(' ')).not.toContain('outro-registry');
  });

  it('já atualizada: informa e sai com 0, sem tocar no disco', async () => {
    const root = await tmp();
    const dir = await instalada(root, 'minha-skill', provBase);
    const lines: string[] = [];
    const code = await runUpdate('minha-skill', {
      out: (l) => lines.push(l),
      fetch: fetchOf('rev_1'),
      registry: 'x',
      skillsDir: root,
      extract: extractStub,
      apply: true,
    });
    expect(code).toBe(0);
    expect(lines.join(' ')).toContain('já está atualizada');
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('antigo');
  });

  it('skill não instalada devolve 1 com mensagem acionável', async () => {
    const root = await tmp();
    const lines: string[] = [];
    const code = await runUpdate('nao-existe', {
      out: (l) => lines.push(l),
      fetch: fetchOf('rev_2'),
      registry: 'x',
      skillsDir: root,
      extract: extractStub,
    });
    expect(code).toBe(1);
    expect(lines.join(' ')).toContain('não parece instalado');
  });

  it('nome com travessia é recusado também no update', async () => {
    const root = await tmp();
    const lines: string[] = [];
    const code = await runUpdate('../fora', {
      out: (l) => lines.push(l),
      fetch: fetchOf('rev_2'),
      registry: 'x',
      skillsDir: root,
      extract: extractStub,
    });
    expect(code).toBe(1);
    expect(lines.join(' ')).toContain('escaparia');
  });
});
