import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M23 — a skill carrega CATEGORIA e MODO DE EXECUÇÃO até o banco.
 *
 * Sem persistir, o campo existe no frontmatter, é validado, e desaparece — o agente
 * descobriria um catálogo sem o eixo que o filtro precisa. Campo validado que não chega ao
 * armazenamento é a forma mais silenciosa de não existir: tudo parece certo na publicação.
 */
describeIntegration('M23 — categoria e execução persistem', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  const publicar = async (skillId: string, over: { category?: string; execution?: string } = {}) => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision({
      skillId,
      name: skillId,
      description: 'Faz X. Use quando Y.',
      payload: Buffer.from('zip'),
      contentHash: `h-${skillId}`,
      frontmatter: { name: skillId, description: 'Faz X. Use quando Y.' },
      skillMd: `# ${skillId}`,
      ...over,
    });
  };

  const ler = async (skillId: string) => {
    const { rows } = await getPool().query<{ category: string | null; execution: string }>(
      'SELECT category, execution FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [DEFAULT_WORKSPACE_ID, skillId],
    );
    return rows[0];
  };

  it('grava a categoria declarada — texto livre, sem normalizar', async () => {
    // Normalizar para minúsculas ou trocar espaço por hífen faria o catálogo exibir algo
    // que o autor não escreveu. O vocabulário é dele.
    await publicar('vendedor', { category: 'Sales' });
    expect((await ler('vendedor'))?.category).toBe('Sales');
  });

  it('sem categoria, a coluna fica NULA — não uma string vazia', async () => {
    // `''` e `NULL` respondem diferente a `WHERE category = $1` e a agregações; escolher
    // um e ser consistente evita a categoria fantasma que aparece em toda listagem.
    await publicar('sem-categoria');
    expect((await ler('sem-categoria'))?.category).toBeNull();
  });

  it('grava o modo de execução, e o default é `remote`', async () => {
    await publicar('instrucional');
    expect((await ler('instrucional'))?.execution).toBe('remote');
    await publicar('com-script', { execution: 'local' });
    expect((await ler('com-script'))?.execution).toBe('local');
  });

  it('o filtro por categoria é POR INQUILINO — nunca varre o catálogo alheio', async () => {
    await publicar('minha', { category: 'Sales' });
    const outro = createSkillsStore(createDb(getPool()), 'ws_alheio');
    await outro.createWithRevision({
      skillId: 'alheia',
      name: 'alheia',
      description: 'd',
      payload: Buffer.from('z'),
      contentHash: 'h2',
      frontmatter: { name: 'alheia', description: 'd' },
      skillMd: '# alheia',
      category: 'Sales',
    });

    const { rows } = await getPool().query<{ skill_id: string }>(
      'SELECT skill_id FROM skills WHERE workspace_id = $1 AND category = $2',
      [DEFAULT_WORKSPACE_ID, 'Sales'],
    );
    expect(rows.map((r) => r.skill_id)).toEqual(['minha']);
  });
});
