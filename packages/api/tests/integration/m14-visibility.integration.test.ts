import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, stubEmbed } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDispatchingRetriever } from '../../src/server/providers/retriever-selection.js';
import { createPgExecutor } from '../../src/server/retrieve/pg-executor.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M14 — visibilidade e catálogo público curado.
 *
 * Resolve o cold start (tenant novo com catálogo vazio tem busca sem valor no dia 1) **sem
 * abrir o acervo de todo mundo**. O risco declarado do milestone é o que este arquivo
 * protege: skill pública é código de TERCEIRO que o agente de outro tenant vai carregar.
 */

const MEU = 'ws_meu';
const ALHEIO = 'ws_alheio';
const TERMO = 'reconciliação de faturamento trimestral';

async function seed(workspaceId: string, nome: string, visibility: string): Promise<string> {
  const pool = getPool();
  const skillId = `sk_${createId()}`;
  const revisionId = `rev_${createId()}`;
  const texto = `${nome} ${TERMO}`;
  await pool.query(
    `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text, visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [workspaceId, skillId, nome, TERMO, revisionId, texto, visibility],
  );
  await pool.query(
    `INSERT INTO skill_revisions (revision_id, workspace_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1,$2,$3,'\\x00',$4,'{}'::jsonb,'corpo')`,
    [revisionId, workspaceId, skillId, `h_${revisionId}`],
  );
  const v = stubEmbed(texto);
  await pool.query(
    `INSERT INTO embeddings (id, workspace_id, revision_id, skill_id, provider, model, dimensions, vector)
     VALUES ($1,$2,$3,$4,'stub','stub',1536,$5::vector)`,
    [`emb_${createId()}`, workspaceId, revisionId, skillId, `[${v.join(',')}]`],
  );
  return skillId;
}

describeIntegration('M14 — visibilidade no retrieve', () => {
  let minha = '';
  let publicaAlheia = '';
  let privadaAlheia = '';
  let sharedAlheia = '';

  beforeEach(async () => {
    await truncateAll();
    minha = await seed(MEU, 'minha-skill', 'private');
    publicaAlheia = await seed(ALHEIO, 'publica-alheia', 'public');
    privadaAlheia = await seed(ALHEIO, 'privada-alheia', 'private');
    sharedAlheia = await seed(ALHEIO, 'shared-alheia', 'shared');
  });
  afterAll(closePool);

  const retriever = (ws: string) =>
    createDispatchingRetriever({
      executor: createPgExecutor(getPool()),
      embedder: createStubEmbedder(),
      workspaceId: ws,
    });

  for (const strategy of ['keyword', 'vector', 'hybrid'] as const) {
    it(`[${strategy}] busca na UNIÃO minhas + públicas, e nada além`, async () => {
      const res = await retriever(MEU).retrieve({ query: TERMO, topK: 20, strategy });
      const ids = res.map((r) => r.skill_id);

      expect(ids, 'a própria skill sumiu').toContain(minha);
      expect(ids, 'a pública alheia não apareceu — cold start não resolvido').toContain(publicaAlheia);
      expect(ids, 'VAZOU uma skill private de outro workspace').not.toContain(privadaAlheia);
      // `shared` é escopo de ORGANIZAÇÃO, que ainda não existe no dado — tratá-la como
      // pública seria abrir acervo alheio por interpretação generosa de um enum.
      expect(ids, 'VAZOU uma skill shared de outro workspace').not.toContain(sharedAlheia);
    });
  }

  it('cada resultado declara sua ORIGEM', async () => {
    // Skill pública é código de terceiro que o agente vai carregar. Sem a marca, o consumidor
    // não distingue o que o próprio time publicou do que veio de fora — e é essa a decisão
    // que ele precisa tomar.
    const res = await retriever(MEU).retrieve({ query: TERMO, topK: 20, strategy: 'keyword' });
    const porId = new Map(res.map((r) => [r.skill_id, r.origin]));
    expect(porId.get(minha)).toBe('own');
    expect(porId.get(publicaAlheia)).toBe('public');
  });

  it('o DONO da pública a vê como `own`, não como `public`', async () => {
    const res = await retriever(ALHEIO).retrieve({ query: TERMO, topK: 20, strategy: 'keyword' });
    expect(res.find((r) => r.skill_id === publicaAlheia)?.origin).toBe('own');
  });

  it('DEFAULT é `private` — visibilidade só aumenta por ação explícita', async () => {
    const pool = getPool();
    const skillId = `sk_${createId()}`;
    await pool.query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
       VALUES ($1,$2,'sem-visibilidade','d','rev_x','sem-visibilidade d')`,
      [ALHEIO, skillId],
    );
    const { rows } = await pool.query<{ visibility: string }>(
      'SELECT visibility FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [ALHEIO, skillId],
    );
    expect(rows[0]?.visibility).toBe('private');
  });

  it('REVOGAÇÃO: voltar a `private` remove a skill do retrieve de todos os outros tenants', async () => {
    // O caminho de revogação é o que torna o catálogo público reversível — sem ele, promover
    // seria uma porta de mão única sobre código executável.
    const antes = await retriever(MEU).retrieve({ query: TERMO, topK: 20, strategy: 'keyword' });
    expect(antes.map((r) => r.skill_id)).toContain(publicaAlheia);

    await getPool().query(
      `UPDATE skills SET visibility = 'private' WHERE workspace_id = $1 AND skill_id = $2`,
      [ALHEIO, publicaAlheia],
    );

    const depois = await retriever(MEU).retrieve({ query: TERMO, topK: 20, strategy: 'keyword' });
    expect(depois.map((r) => r.skill_id), 'revogação não teve efeito').not.toContain(publicaAlheia);
    // E o dono continua enxergando a própria.
    const doDono = await retriever(ALHEIO).retrieve({ query: TERMO, topK: 20, strategy: 'keyword' });
    expect(doDono.map((r) => r.skill_id)).toContain(publicaAlheia);
  });

  it('skill deletada não aparece nem sendo pública', async () => {
    await getPool().query(
      `UPDATE skills SET deleted_at = now() WHERE workspace_id = $1 AND skill_id = $2`,
      [ALHEIO, publicaAlheia],
    );
    const res = await retriever(MEU).retrieve({ query: TERMO, topK: 20, strategy: 'keyword' });
    expect(res.map((r) => r.skill_id)).not.toContain(publicaAlheia);
  });
});
