import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M31 — a listagem distingue PUBLICADA de ACHÁVEL.
 *
 * A auditoria de UX mediu que o painel mostra uma skill sem embedding **idêntica** a uma
 * indexada. Quem publica não descobre por que a skill nunca aparece na busca: o registro diz
 * que ela está lá, e a busca não a encontra. Os dois estão certos, e o operador não tem como
 * saber disso.
 *
 * `visibility` tem história parecida: escrito por `PUT .../visibility` desde o M14, usado num
 * `WHERE`, e **nunca devolvido** — mudava-se sem poder conferir.
 *
 * POR QUE INTEGRAÇÃO, e não contract: a mudança é uma PROJEÇÃO de banco, e o `EXISTS`
 * correlacionado é justamente o que precisa ser exercitado contra o Postgres real. Um duplo
 * devolveria o que eu mandasse devolver e provaria só que eu sei escrever um duplo. O plano
 * dizia "contract test" — corrigido aqui, com o motivo, em vez de escrever um teste no nível
 * errado para bater com o texto do plano.
 */
const WS = 'ws_m31_list';

describeIntegration('listagem: publicada não é o mesmo que achável (M31)', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closePool();
  });

  it('marca `embedded: false` para skill cuja revisão vigente não tem embedding', async () => {
    const store = createSkillsStore(createDb(getPool()), WS);
    await store.createWithRevision({
      skillId: 'sem-embedding',
      name: 'sem-embedding',
      description: 'publicada, porém invisível à busca semântica',
      payload: Buffer.from('z'),
      contentHash: 'h1',
      frontmatter: {},
      skillMd: '# corpo',
    });

    const page = await store.listPaginated(10, null);
    const view = page.skills.find((s) => s.skill_id === 'sem-embedding');

    // O caso que importa: nada gerou embedding, então a skill NÃO é descobrível — e a
    // listagem passa a dizer isso, em vez de mostrá-la como qualquer outra.
    expect(view?.embedded).toBe(false);
  });

  it('devolve `visibility`, que era escrito e nunca lido de volta', async () => {
    const store = createSkillsStore(createDb(getPool()), WS);
    await store.createWithRevision({
      skillId: 'com-visibilidade',
      name: 'com-visibilidade',
      description: 'qualquer',
      payload: Buffer.from('z'),
      contentHash: 'h2',
      frontmatter: {},
      skillMd: '# corpo',
    });

    const page = await store.listPaginated(10, null);
    const view = page.skills.find((s) => s.skill_id === 'com-visibilidade');

    // Asserta a FORMA, não um valor fixo: a coluna existe desde o M14 e pode ter linha antiga
    // com valor que ninguém previu. Travar num literal faria o teste falhar por DADO, não por
    // código — e o que se quer provar é que o campo chega ao consumidor.
    expect(typeof view?.visibility).toBe('string');
    expect(view?.visibility.length).toBeGreaterThan(0);
  });
});
