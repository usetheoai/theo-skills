import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createEmbeddingsStore } from '../../src/server/store/embeddings-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * REGRESSÃO — o store de embeddings ignorava o inquilino em dois pontos.
 *
 * 1. `getEmbedSourceByRevision` fazia `innerJoin(skills, eq(skills.skillId, rev.skillId))` —
 *    **só por `skill_id`**. A PK de `skills` é o par (workspace, skill), então a revisão de um
 *    cliente casava com a linha de skill de OUTRO: `name`/`description` do vizinho entravam no
 *    texto embeddado deste, e o `isNull(skills.deletedAt)` passava a ser lido da skill errada
 *    (revisão de skill apagada voltava a ser indexada).
 *
 * 2. `upsert` não gravava `workspace_id`. A coluna cai no default `'default'`, e o
 *    vector-retriever junta por `s.workspace_id = e.workspace_id` — corretamente. Resultado:
 *    a busca vetorial de todo cliente que não seja `default` nunca casava e devolvia zero.
 *    Não é vazamento (o JOIN do retriever impede), é **cegueira**: a descoberta semântica
 *    simplesmente não funcionava para nenhum cliente real.
 *
 * O teste de isolamento que existia mascarava (2): ele insere o embedding por SQL cru, já com
 * o `workspace_id` certo. Prova que a leitura respeita o escopo — sobre uma linha que nunca
 * passou pelo `upsert`.
 */

const MEU = 'ws_meu';
const ALHEIO = 'ws_alheio';
const COLIDIDO = 'deploy-helper';

const semear = async (ws: string, texto: string) => {
  const skills = createSkillsStore(createDb(getPool()), ws);
  await skills.createWithRevision({
    skillId: COLIDIDO,
    name: `nome-de-${ws}`,
    description: texto,
    payload: Buffer.from(`zip-${ws}`),
    contentHash: `hash-${ws}`,
    frontmatter: { name: `nome-de-${ws}`, description: texto },
    skillMd: `# ${ws}\n\n${texto}`,
  });
  const rows = await getPool().query<{ revision_id: string }>(
    'SELECT revision_id FROM skill_revisions WHERE workspace_id = $1 AND skill_id = $2',
    [ws, COLIDIDO],
  );
  return rows.rows[0]!.revision_id;
};

describeIntegration('M11 — embeddings sob o inquilino', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('a fonte do embed vem da MINHA skill, não da homônima alheia', async () => {
    // O alheio primeiro, para tender a vir antes na ordem de heap — que é o que um JOIN
    // sem igualdade de workspace devolvia.
    await semear(ALHEIO, 'descricao DO ALHEIO');
    const meuRev = await semear(MEU, 'descricao MINHA');

    const store = createEmbeddingsStore(createDb(getPool()), MEU);
    const fonte = await store.getEmbedSourceByRevision(meuRev);

    expect(fonte, 'a revisão é minha e existe').toBeDefined();
    expect(
      fonte?.description,
      'o texto embeddado veio da skill de OUTRO cliente',
    ).toBe('descricao MINHA');
    expect(fonte?.name).toBe(`nome-de-${MEU}`);
  });

  it('o upsert grava o inquilino — senão a busca vetorial fica cega', async () => {
    const meuRev = await semear(MEU, 'descricao MINHA');

    const store = createEmbeddingsStore(createDb(getPool()), MEU);
    await store.upsert({
      id: 'emb_1',
      revisionId: meuRev,
      skillId: COLIDIDO,
      provider: 'stub',
      model: 'stub-1',
      dimensions: 1536,
      vector: Array.from({ length: 1536 }, () => 0.01),
    });

    const { rows } = await getPool().query<{ workspace_id: string }>(
      'SELECT workspace_id FROM embeddings WHERE id = $1',
      ['emb_1'],
    );
    expect(rows.length).toBe(1);
    expect(
      rows[0]?.workspace_id,
      'embedding gravado em `default` — o vector retrieve do cliente nunca casaria',
    ).toBe(MEU);
    expect(rows[0]?.workspace_id).not.toBe(DEFAULT_WORKSPACE_ID);
  });
});
