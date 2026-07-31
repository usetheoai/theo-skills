import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PROVENANCE_FILE, resolveSkillsDir, runInstall, safeSkillDir } from '../../src/commands/install.js';

/**
 * M18 — `theoskill install`, o "último metro" que o ADR 0005 nomeou como dívida: até aqui o
 * registry publicava skills que nenhum agente instalava.
 */

const ZIP = Buffer.from('conteudo-da-skill');
const HASH = createHash('sha256').update(ZIP).digest('hex');

/**
 * O duplo ESPELHA a API real, e este comentário existe porque antes ele não espelhava.
 *
 * O stub anterior devolvia `payload_base64` no metadado da revisão — um campo que o servidor
 * NUNCA produziu. Os testes passavam porque o duplo concordava com a expectativa da CLI, e
 * contra o registry implantado o comando morria em `Buffer.from(undefined)`. Um duplo que
 * ninguém confrontou com o servidor não prova integração: prova que ele combina com o cliente.
 *
 * Formato REAL, medido em `GET /v1/skills/:id/revisions/:revisionId`:
 *   { revision_id, skill_id, content_hash, create_time }   ← metadado, SEM bytes
 * e os bytes na rota separada `…/payload`, como `application/zip`.
 */
const responses = (over: Record<string, unknown> = {}) => ({
  skill: { skill_id: 'sk_1', name: 'minha-skill', latest_revision_id: 'rev_1', ...over },
  revision: { revision_id: 'rev_1', skill_id: 'sk_1', content_hash: HASH, create_time: '2026-07-31T00:00:00Z' },
});

const fetchOf = (r: ReturnType<typeof responses>, overrideRevision?: unknown, payload: Buffer = ZIP) =>
  ((url: string) => {
    if (url.endsWith('/payload')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(url.includes('/revisions/') ? (overrideRevision ?? r.revision) : r.skill),
    });
  }) as unknown as typeof globalThis.fetch;

const dirs: string[] = [];
const tmp = async (): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), 'skinstall-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  dirs.length = 0;
});

describe('runInstall', () => {
  const extractStub = async (zip: Buffer, dest: string): Promise<void> => {
    await writeFile(join(dest, 'SKILL.md'), zip.toString('utf8'), 'utf8');
  };

  it('materializa a skill no diretório e grava a proveniência', async () => {
    const root = await tmp();
    const lines: string[] = [];
    const code = await runInstall('sk_1', {
      out: (l) => lines.push(l),
      fetch: fetchOf(responses()),
      registry: 'https://reg.test',
      skillsDir: root,
      extract: extractStub,
      now: () => new Date('2026-07-31T00:00:00Z'),
    });
    expect(code).toBe(0);

    const dest = join(root, 'minha-skill');
    expect(await readdir(dest)).toContain('SKILL.md');

    const prov = JSON.parse(await readFile(join(dest, PROVENANCE_FILE), 'utf8')) as Record<string, string>;
    expect(prov).toMatchObject({
      registry: 'https://reg.test',
      skill_id: 'sk_1',
      revision_id: 'rev_1',
      content_hash: HASH,
      installed_at: '2026-07-31T00:00:00.000Z',
    });
  });

  it('INTEGRIDADE: hash divergente aborta SEM escrever nada', async () => {
    // Verificar depois de extrair deixaria uma pasta parcial de conteúdo não confiável no
    // ambiente do usuário — e um agente que varre o diretório a carregaria.
    const root = await tmp();
    const lines: string[] = [];
    const code = await runInstall('sk_1', {
      out: (l) => lines.push(l),
      fetch: fetchOf(responses(), { revision_id: 'rev_1', skill_id: 'sk_1', content_hash: 'hash-que-nao-bate' }),
      registry: 'https://reg.test',
      skillsDir: root,
      extract: extractStub,
    });
    expect(code).toBe(1);
    expect(lines.join(' ')).toContain('integridade falhou');
    expect(await readdir(root)).toEqual([]);
  });

  it('PATH TRAVERSAL: nome que escapa do diretório é recusado', async () => {
    // O `name` vem do frontmatter — dado de TERCEIRO. Sem esta guarda, um instalador vira
    // escrita arbitrária no disco de quem instala.
    const root = await tmp();
    const lines: string[] = [];
    const code = await runInstall('sk_1', {
      out: (l) => lines.push(l),
      fetch: fetchOf(responses({ name: '../../fora' })),
      registry: 'https://reg.test',
      skillsDir: root,
      extract: extractStub,
    });
    expect(code).toBe(1);
    expect(lines.join(' ')).toContain('escaparia');
    expect(await readdir(root)).toEqual([]);
  });

  it('safeSkillDir recusa travessia e caminho absoluto, e aceita nome comum', () => {
    const root = '/tmp/skills';
    expect(() => safeSkillDir(root, '../fora')).toThrow(/escaparia/);
    expect(() => safeSkillDir(root, 'a/../../fora')).toThrow(/escaparia/);
    expect(() => safeSkillDir(root, '/etc/passwd')).toThrow();
    expect(safeSkillDir(root, 'minha-skill')).toBe('/tmp/skills/minha-skill');
  });

  it('IDEMPOTENTE: reinstalar substitui e não deixa arquivo órfão da revisão anterior', async () => {
    // Sem o `rm`, um arquivo removido numa revisão nova permaneceria no disco e o agente
    // continuaria a carregá-lo — uma skill que ninguém publicou mais.
    const root = await tmp();
    const base = {
      out: () => undefined,
      registry: 'https://reg.test',
      skillsDir: root,
    };
    await runInstall('sk_1', {
      ...base,
      fetch: fetchOf(responses()),
      extract: async (_z, dest) => {
        await writeFile(join(dest, 'SKILL.md'), 'v1', 'utf8');
        await writeFile(join(dest, 'antigo.md'), 'some', 'utf8');
      },
    });
    await runInstall('sk_1', { ...base, fetch: fetchOf(responses()), extract: extractStub });

    const arquivos = await readdir(join(root, 'minha-skill'));
    expect(arquivos).toContain('SKILL.md');
    expect(arquivos, 'arquivo da revisão anterior sobreviveu').not.toContain('antigo.md');
  });

  it('skill inexistente devolve 1 sem criar diretório', async () => {
    const root = await tmp();
    const notFound = (() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })) as unknown as typeof globalThis.fetch;
    const code = await runInstall('sk_x', {
      out: () => undefined,
      fetch: notFound,
      registry: 'https://reg.test',
      skillsDir: root,
      extract: extractStub,
    });
    expect(code).toBe(1);
    expect(await readdir(root)).toEqual([]);
  });

  it('LAYOUT: o default é `.claude/skills` do projeto, e `--global` vai para o home', () => {
    // O mesmo layout que os agentes leem — decisão 4 do ADR 0005: a interoperabilidade
    // com o `openskills` é por DISCO, porque ele não tem cliente HTTP.
    expect(resolveSkillsDir({})).toBe(join(process.cwd(), '.claude', 'skills'));
    expect(resolveSkillsDir({ global: true })).toMatch(/\.claude[/\\]skills$/);
  });

  it('RUNTIME theokit: instala em `.theokit/skills`, senão o agente Theokit NÃO VÊ a skill', () => {
    // MEDIDO em `@theokit/agents` 6.0.0: o pacote descobre skills EXCLUSIVAMENTE em
    // `.theokit/skills/<name>/SKILL.md` e NÃO tem uma única referência a `.claude` —
    // `grep -rlo "\.claude" node_modules/@theokit/agents/dist` devolve vazio.
    //
    // O ADR 0005 escolheu `.claude/skills` pelo `openskills`, e a escolha era correta PARA
    // ELE. O que faltou é que os dois layouts servem consumidores DIFERENTES: no
    // agent-builder (agente Theokit real, v0.103.0) as duas pastas coexistem, e a única
    // skill que o agente carrega vive em `.theokit/skills/daily-briefing/`.
    //
    // Enquanto a CLI só escrevia em `.claude/skills`, uma skill vinda do registry era
    // INVISÍVEL para todo agente Theokit — o consumidor que o M7 exige. Não é preferência
    // de caminho: é a entrega não chegando ao destinatário.
    expect(resolveSkillsDir({ runtime: 'theokit' })).toBe(join(process.cwd(), '.theokit', 'skills'));
    expect(resolveSkillsDir({ runtime: 'theokit', global: true })).toMatch(/\.theokit[/\\]skills$/);
  });

  it('RUNTIME: `claude` continua sendo o default — o ADR 0005 não é revogado, é completado', () => {
    expect(resolveSkillsDir({ runtime: 'claude' })).toBe(resolveSkillsDir({}));
  });

  it('RUNTIME: `--skills-dir` explícito vence o runtime — quem passa caminho manda', () => {
    expect(resolveSkillsDir({ runtime: 'theokit', skillsDir: '/tmp/x' })).toBe('/tmp/x');
  });
});
