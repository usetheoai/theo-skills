import { createKeywordRetriever, DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M23 — a DESCOBERTA devolve o que o agente precisa para decidir sem baixar nada.
 *
 * O mecanismo é de duas fases, o mesmo de um agente local: **descobrir** devolve uma lista
 * compacta (nome, descrição, categoria, modo de execução) que cabe no prompt, e **carregar**
 * traz o corpo só da skill escolhida. A diferença é que o corpo mora no servidor.
 *
 * Sem `execution` na descoberta o agente não sabe se aquela skill ele PODE carregar como
 * instrução ou se ela exige instalação na máquina do cliente — e descobriria isso tarde,
 * seguindo passos que referenciam arquivos inexistentes.
 */
describeIntegration('M23 — descoberta com categoria e modo de execução', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  const semear = async (skillId: string, texto: string, over: { category?: string; execution?: string } = {}) => {
    const store = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await store.createWithRevision({
      skillId,
      name: skillId,
      description: texto,
      payload: Buffer.from('z'),
      contentHash: `h-${skillId}`,
      frontmatter: { name: skillId, description: texto },
      skillMd: `# ${skillId}\n\n${texto}`,
      ...over,
    });
  };

  const buscar = (query: string, filtro?: { category?: string }) =>
    createKeywordRetriever({
      executor: { query: async (sql, params) => (await getPool().query(sql, [...params])).rows as never },
      workspaceId: DEFAULT_WORKSPACE_ID,
    }).retrieve({ query, topK: 10, ...(filtro ?? {}) });

  it('devolve categoria e modo de execução — o agente decide sem uma segunda chamada', async () => {
    await semear('fechar-venda', 'fecha negociacao de venda', { category: 'Sales', execution: 'remote' });
    const [r] = await buscar('venda');
    expect(r?.skill_id).toBe('fechar-venda');
    expect(r?.category).toBe('Sales');
    expect(r?.execution, 'sem isto o agente carregaria como instrução algo que exige instalação').toBe('remote');
  });

  it('skill com script aparece marcada como `local`', async () => {
    await semear('deploy-loja', 'faz deploy da loja', { category: 'Shop', execution: 'local' });
    const [r] = await buscar('deploy');
    expect(r?.execution).toBe('local');
  });

  it('FILTRA por categoria', async () => {
    await semear('venda-a', 'atendimento ao cliente', { category: 'Sales' });
    await semear('loja-a', 'atendimento ao cliente', { category: 'Shop' });
    const nomes = (await buscar('atendimento', { category: 'Sales' })).map((r) => r.skill_id);
    expect(nomes).toEqual(['venda-a']);
  });

  it('sem filtro, devolve todas as categorias', async () => {
    await semear('venda-b', 'atendimento', { category: 'Sales' });
    await semear('loja-b', 'atendimento', { category: 'Shop' });
    expect((await buscar('atendimento')).length).toBe(2);
  });

  it('o filtro NÃO atravessa inquilino', async () => {
    // Categoria é eixo de conveniência; nunca pode virar caminho lateral para o catálogo
    // alheio. A cláusula de inquilino continua sendo a primeira.
    await semear('minha', 'atendimento', { category: 'Sales' });
    const outro = createSkillsStore(createDb(getPool()), 'ws_alheio');
    await outro.createWithRevision({
      skillId: 'alheia', name: 'alheia', description: 'atendimento',
      payload: Buffer.from('z'), contentHash: 'h2',
      frontmatter: { name: 'alheia', description: 'atendimento' }, skillMd: '# alheia',
      category: 'Sales',
    });
    expect((await buscar('atendimento', { category: 'Sales' })).map((r) => r.skill_id)).toEqual(['minha']);
  });
});
