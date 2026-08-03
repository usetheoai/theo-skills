import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * O filtro por categoria, pela ROTA — não pelo retriever isolado.
 *
 * O único teste que existia chamava `createKeywordRetriever` direto, então a perna que estava
 * quebrada (a vetorial) nunca era exercitada, e o defeito atravessou a suíte inteira verde.
 * Testar a peça que você sabe estar certa é o formato de cobertura que não protege nada.
 *
 * Aqui a chamada é HTTP, na estratégia PADRÃO — que é como o agente de fato pergunta.
 */
const WS = 'ws_cat';

describeIntegration('filtro por categoria pela rota, na estratégia padrão', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    const skills = createSkillsStore(createDb(getPool()), WS);
    for (const [id, cat] of [['fechar-venda', 'Sales'], ['fechar-chamado', 'Ops']] as const) {
      await skills.createWithRevision({
        skillId: id,
        name: id,
        description: 'como fechar com o cliente de forma consultiva',
        payload: Buffer.from('z'),
        contentHash: `h-${id}`,
        frontmatter: {},
        skillMd: '# fechar',
        version: '1.0.0',
        category: cat,
        execution: 'remote',
      });
    }
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const app = () =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: (): Principal => ({
        workspaceId: WS,
        userId: 'u',
        role: 'member',
        scopes: ['skills:read'],
      }),
    });

  const buscar = async (qs: string): Promise<string[]> => {
    const res = await app().request(`/v1/skills:retrieve?query=fechar&${qs}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { results: { skill_id: string }[] }).results.map((r) => r.skill_id);
  };

  it('category=Sales devolve só a de Sales — as duas casam o termo', async () => {
    expect(await buscar('category=Sales')).toEqual(['fechar-venda']);
  });

  it('category=Ops devolve só a de Ops — prova que não é coincidência de ordenação', async () => {
    // Sem este segundo caso, um filtro que sempre devolvesse a primeira linha passaria no
    // primeiro teste. Duas direções distinguem filtro de sorte.
    expect(await buscar('category=Ops')).toEqual(['fechar-chamado']);
  });

  it('categoria inexistente devolve lista vazia, não o catálogo inteiro', async () => {
    expect(await buscar('category=Jardinagem')).toEqual([]);
  });

  it('sem categoria, as duas voltam — o filtro não vaza para quem não pediu', async () => {
    expect((await buscar('')).sort()).toEqual(['fechar-chamado', 'fechar-venda']);
  });
});
