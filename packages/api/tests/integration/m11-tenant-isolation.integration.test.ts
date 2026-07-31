import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, stubEmbed } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M11 DoD #5 — o workspace B não lê NADA do A, "nem por id direto, nem pelo retrieve".
 *
 * O retrieve é a metade que faltava. Os stores já são escopados por factory
 * (`createSkillsStore(db, workspaceId)`), mas o caminho de busca é outro: o
 * `RetrieveParams` não carrega workspace e o SQL do keyword/vector não filtra —
 * um tenant enxergava o catálogo inteiro pela rota de descoberta.
 *
 * Este teste existe para tornar isso VISÍVEL antes de ser corrigido, e para
 * impedir a regressão depois. Ele roda contra `ankane/pgvector` real (não mock),
 * porque o risco #1 do M11 é justamente o comportamento do índice sob filtro.
 */

const WS_A = 'ws_alpha';
const WS_B = 'ws_beta';

const SECRET_OF_A = 'quarterly revenue reconciliation ledger';
const SECRET_OF_B = 'kubernetes cluster autoscaler tuning';

/** Semeia uma skill completa (skill + revisão + embedding) num workspace. */
async function seedSkill(workspaceId: string, name: string, body: string): Promise<string> {
  const pool = getPool();
  const skillId = `sk_${createId()}`;
  const revisionId = `rev_${createId()}`;
  const searchText = `${name} ${body}`;
  await pool.query(
    `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [workspaceId, skillId, name, body, revisionId, searchText],
  );
  await pool.query(
    `INSERT INTO skill_revisions (revision_id, workspace_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1,$2,$3,'\\x00',$4,'{}'::jsonb,$5)`,
    [revisionId, workspaceId, skillId, `h_${revisionId}`, body],
  );
  const v = stubEmbed(searchText);
  await pool.query(
    `INSERT INTO embeddings (id, workspace_id, revision_id, skill_id, provider, model, dimensions, vector)
     VALUES ($1,$2,$3,$4,'stub','stub',1536,$5::vector)`,
    [`emb_${createId()}`, workspaceId, revisionId, skillId, `[${v.join(',')}]`],
  );
  return skillId;
}

describeIntegration('M11 — isolamento por workspace no RETRIEVE (DoD #5)', () => {
  let skillOfA = '';

  beforeAll(async () => {
    await truncateAll();
    skillOfA = await seedSkill(WS_A, 'ledger-reconciler', SECRET_OF_A);
    await seedSkill(WS_B, 'autoscaler-tuner', SECRET_OF_B);
  });
  afterAll(closePool);

  const retrieverFor = (workspaceId: string) =>
    createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId,
    });

  for (const strategy of ['keyword', 'vector', 'hybrid'] as const) {
    it(`[${strategy}] o workspace B não recebe a skill do A nem buscando o texto exato dela`, async () => {
      // Busca literal pelo conteúdo de A, a partir de B. Se algum resultado voltar,
      // o catálogo de um cliente vazou para outro pela rota de descoberta.
      const results = await retrieverFor(WS_B).retrieve({
        query: SECRET_OF_A,
        topK: 10,
        strategy,
      });
      const leaked = results.filter((r) => r.skill_id === skillOfA);
      expect(
        leaked,
        `VAZAMENTO: retrieve de ${WS_B} devolveu ${leaked.length} skill(s) de ${WS_A} ` +
          `(ids: ${leaked.map((r) => r.skill_id).join(',')})`,
      ).toEqual([]);
    });
  }

  it('[hybrid] o dono continua encontrando a própria skill (o filtro isola, não cega)', async () => {
    // Contraprova indispensável: um filtro que zera TUDO também passaria no teste
    // acima. Sem esta asserção, `return []` seria uma "correção" válida.
    const results = await retrieverFor(WS_A).retrieve({
      query: SECRET_OF_A,
      topK: 10,
      strategy: 'hybrid',
    });
    expect(results.map((r) => r.skill_id)).toContain(skillOfA);
  });

  it('um workspace inexistente não enxerga nada', async () => {
    const results = await retrieverFor('ws_does_not_exist').retrieve({
      query: SECRET_OF_A,
      topK: 10,
      strategy: 'hybrid',
    });
    expect(results).toEqual([]);
  });
});
