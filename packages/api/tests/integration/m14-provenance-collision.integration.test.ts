import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createMembersStore } from '../../src/server/store/members-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * REGRESSÃO — `GET /v1/skills/:id/provenance` sob colisão de `skill_id` entre inquilinos.
 *
 * A identidade de uma skill é o par **(workspace_id, skill_id)** — a PK é composta, e o
 * comentário do schema diz por quê: como PK global, o primeiro inquilino a registrar
 * `deploy-helper` bloquearia o nome para todos os outros para sempre.
 *
 * A consulta de proveniência filtrava **só** por `skill_id`, com `limit(1)` e sem `ORDER BY`.
 * Duas linhas com o mesmo `skill_id` em workspaces distintos são o caso NORMAL neste schema,
 * e a linha devolvida era arbitrária (ordem de heap do Postgres). Dois modos de falha:
 *
 *  1. **404 falso** — a pública é minha, mas a linha sorteada é a privada homônima de outro
 *     inquilino: nego a proveniência do que é meu.
 *  2. **Vazamento entre inquilinos** — se a sorteada é a pública de OUTRO inquilino, devolvo
 *     o `published_by` dele (identificador de usuário de outra organização) como se fosse a
 *     proveniência da skill perguntada.
 *
 * O (2) é o grave: não é dado público sendo lido por quem pode: é atribuir o publicador de
 * uma organização a uma skill de outra.
 */

const MEU = 'ws_meu';
const ALHEIO = 'ws_alheio';
/** O MESMO id nos dois workspaces — legítimo sob a PK composta. */
const COLIDIDO = 'deploy-helper';

const principalOf = (userId: string, ws: string): Principal => ({
  workspaceId: ws,
  userId,
  role: 'member',
  scopes: ['skills:admin'],
});

describeIntegration('M14 — proveniência sob colisão de skill_id entre inquilinos', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  const appAs = (userId: string, ws: string) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalOf(userId, ws),
    });

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    const pool = getPool();

    for (const [id, email] of [
      ['u_meu', 'meu@p.dev'],
      ['u_alheio', 'alheio@p.dev'],
    ]) {
      await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', [id, email]);
    }
    await createMembersStore(createDb(pool), MEU).upsert('u_meu', 'admin');
    await createMembersStore(createDb(pool), ALHEIO).upsert('u_alheio', 'admin');

    // A do OUTRO inquilino é inserida PRIMEIRO — assim ela tende a vir antes na ordem de
    // heap, que é exatamente o que um `limit(1)` sem `ORDER BY` devolvia.
    await pool.query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id,
                           search_text, visibility, published_by, published_at)
       VALUES ($1,$2,'deploy-helper','do alheio','rev_a','deploy-helper',
               'public','u_alheio', now())`,
      [ALHEIO, COLIDIDO],
    );
    await pool.query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id,
                           search_text, visibility, published_by, published_at)
       VALUES ($1,$2,'deploy-helper','a minha','rev_m','deploy-helper',
               'public','u_meu', now())`,
      [MEU, COLIDIDO],
    );
  });

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('devolve a proveniência do MEU workspace, não a do homônimo alheio', async () => {
    const res = await appAs('u_meu', MEU).request(`/v1/skills/${COLIDIDO}/provenance`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { published_by: string | null };
    expect(
      body.published_by,
      'devolveu o publicador de OUTRA organização como proveniência da minha skill',
    ).toBe('u_meu');
  });

  it('o outro inquilino recebe a própria, não a minha', async () => {
    const res = await appAs('u_alheio', ALHEIO).request(`/v1/skills/${COLIDIDO}/provenance`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published_by: string | null };
    expect(body.published_by).toBe('u_alheio');
  });

  it('a minha PRIVADA não é ocultada por uma pública alheia de mesmo id', async () => {
    // Modo de falha (1): sem o filtro, a linha sorteada podia ser a alheia e o predicado
    // `visibility !== 'public' && workspaceId !== actor.workspaceId` produzia 404 sobre uma
    // skill que é minha e existe.
    const pool = getPool();
    await pool.query(`UPDATE skills SET visibility='private', published_by=NULL, published_at=NULL
                      WHERE workspace_id=$1 AND skill_id=$2`, [MEU, COLIDIDO]);

    const res = await appAs('u_meu', MEU).request(`/v1/skills/${COLIDIDO}/provenance`);
    expect(res.status, 'negou proveniência de uma skill do próprio workspace').toBe(200);
    const body = (await res.json()) as { visibility: string };
    expect(body.visibility).toBe('private');
  });
});
