import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, stubEmbed } from '@usetheo/skills';
import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { type Logger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M32 — o opt-in do ciclo de vida na fronteira HTTP.
 *
 * O default esconde rascunho, descontinuada e desabilitada porque a descoberta serve quem
 * procura algo para USAR. Mas esconder sem escapatória é perda de dado: as três flags existem
 * para que um autor confira os próprios rascunhos e um operador audite o que saiu de circulação.
 *
 * São três flags e não um `include_hidden` único porque as perguntas são diferentes — quem
 * audita descontinuadas não quer rascunho alheio no meio.
 */

async function seed(
  skillId: string,
  description: string,
  lifecycle: 'active' | 'draft' | 'deprecated',
  enabled = true,
): Promise<void> {
  const revisionId = `rev_${createId()}`;
  const searchText = `${skillId} ${description}`;
  await getPool().query(
    `INSERT INTO skills (skill_id, name, description, latest_revision_id, search_text, lifecycle, enabled, deprecation_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      skillId,
      skillId,
      description,
      revisionId,
      searchText,
      lifecycle,
      enabled,
      lifecycle === 'deprecated' ? 'substituída' : null,
    ],
  );
  await getPool().query(
    `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1,$2,'\\x00','h','{}'::jsonb,$3)`,
    [revisionId, skillId, description],
  );
  const v = stubEmbed(searchText);
  await getPool().query(
    `INSERT INTO embeddings (id, revision_id, skill_id, provider, model, dimensions, vector)
     VALUES ($1,$2,$3,'stub','stub',1536,$4::vector)`,
    [`emb_${createId()}`, revisionId, skillId, `[${v.join(',')}]`],
  );
}

const stubQueue = {} as unknown as PgBoss;
const silentLogger: Logger = { info: () => undefined, error: () => undefined };

async function idsFrom(app: Hono<AppEnv>, qs: string): Promise<string[]> {
  const res = await app.request(`/v1/skills:retrieve?query=converte%20documentos&topK=20${qs}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: { skill_id: string }[] };
  return body.results.map((r) => r.skill_id);
}

describeIntegration('M32 — opt-in do ciclo de vida em GET /v1/skills:retrieve', () => {
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    await truncateAll();
    app = createApp({
      pool: getPool(),
      queue: stubQueue,
      logger: silentLogger,
      embedder: createStubEmbedder(),
    });
    await seed('lc-viva', 'converte documentos', 'active');
    await seed('lc-rascunho', 'converte documentos', 'draft');
    await seed('lc-velha', 'converte documentos', 'deprecated');
    await seed('lc-desligada', 'converte documentos', 'active', false);
  });

  afterAll(closePool);

  it('sem flags, devolve apenas a skill viva e habilitada', async () => {
    const ids = await idsFrom(app, '');
    expect(ids).toEqual(['lc-viva']);
  });

  it('include_deprecated traz a descontinuada — e não o rascunho', async () => {
    const ids = await idsFrom(app, '&include_deprecated=true');
    expect(ids).toContain('lc-velha');
    expect(ids).not.toContain('lc-rascunho');
  });

  it('include_draft traz o rascunho — e não a descontinuada', async () => {
    const ids = await idsFrom(app, '&include_draft=true');
    expect(ids).toContain('lc-rascunho');
    expect(ids).not.toContain('lc-velha');
  });

  it('include_disabled traz a desligada sem trazer rascunho nem descontinuada', async () => {
    // A ortogonalidade, medida na fronteira: os eixos compõem em vez de se anularem.
    const ids = await idsFrom(app, '&include_disabled=true');
    expect(ids).toContain('lc-desligada');
    expect(ids).not.toContain('lc-rascunho');
    expect(ids).not.toContain('lc-velha');
  });

  it('com as três flags, o resultado é o mesmo de antes do milestone — nada foi perdido', async () => {
    // A prova de compatibilidade: o M32 restringiu o DEFAULT, não a capacidade.
    const ids = await idsFrom(app, '&include_draft=true&include_deprecated=true&include_disabled=true');
    expect(ids.sort()).toEqual(['lc-desligada', 'lc-rascunho', 'lc-velha', 'lc-viva']);
  });

  it('flag com valor inválido é recusada com 400, não ignorada em silêncio', async () => {
    // Caso negativo. Aceitar `talvez` como `false` devolveria o recorte a quem pediu o acervo
    // completo, sem nenhum sinal de que o pedido foi descartado — plausível e errado, que é o
    // modo mais caro de falhar.
    const res = await app.request(
      '/v1/skills:retrieve?query=converte%20documentos&include_deprecated=talvez',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('include_deprecated=false é respeitado como negação', async () => {
    // `z.coerce.boolean()` trataria qualquer string não-vazia como verdadeira, e esta chamada
    // devolveria a descontinuada. É por isso que a flag é um enum explícito.
    const ids = await idsFrom(app, '&include_deprecated=false');
    expect(ids).not.toContain('lc-velha');
  });
});
