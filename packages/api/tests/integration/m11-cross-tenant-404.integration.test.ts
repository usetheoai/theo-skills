import { createId } from '@paralleldrive/cuid2';
import { type Principal } from '@usetheo/skills';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M11 DoD #4 — "Acesso cross-tenant devolve **404** em todas as rotas por id — incluindo
 * revisões e operações."
 *
 * Por que 404 e não 403: um `403` confirma que o recurso EXISTE. Num registry multi-tenant
 * isso já é vazamento — permite enumerar os ids de outro cliente e descobrir o que ele
 * publicou, mesmo sem ler o conteúdo. O `404` é indistinguível de "nunca existiu", que é
 * exatamente o que o outro tenant deve enxergar.
 *
 * O teste percorre TODAS as rotas por id, não uma amostra: é o tipo de cobertura em que uma
 * rota esquecida é o incidente inteiro.
 */

const WS_OWNER = 'ws_owner';
const WS_INTRUDER = 'ws_intruder';

const principalFor = (workspaceId: string): Principal => ({
  workspaceId,
  userId: `user_${workspaceId}`,
  role: 'admin',
  scopes: [],
});

describeIntegration('M11 — cross-tenant devolve 404 em toda rota por id (DoD #4)', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;
  let skillId = '';
  let revisionId = '';
  let operationId = '';
  let endpointId = '';

  const appAs = (workspaceId: string) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalFor(workspaceId),
    });

  beforeAll(async () => {
    boss = await startBoss();
    await truncateAll();
    const pool = getPool();

    // Recursos do DONO, semeados direto no banco: o objetivo é testar a LEITURA cross-tenant,
    // não o caminho de escrita (que já tem cobertura própria).
    skillId = `sk_${createId()}`;
    revisionId = `rev_${createId()}`;
    operationId = `op_${createId()}`;
    endpointId = `whe_${createId()}`;

    await pool.query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
       VALUES ($1,$2,'owned-skill','skill do dono',$3,'owned-skill skill do dono')`,
      [WS_OWNER, skillId, revisionId],
    );
    await pool.query(
      `INSERT INTO skill_revisions (revision_id, workspace_id, skill_id, payload, content_hash, frontmatter, skill_md)
       VALUES ($1,$2,$3,'\\x00',$4,'{}'::jsonb,'corpo')`,
      [revisionId, WS_OWNER, skillId, `h_${revisionId}`],
    );
    await pool.query(
      // 'ACTIVE', não 'SUCCEEDED': o enum do contrato é CREATING|UPDATING|DELETING|ACTIVE|FAILED.
      //
      // A primeira versão deste seed usou 'SUCCEEDED' e a rota respondeu 500 ao PRÓPRIO DONO.
      // O erro era do teste, mas o MODO de falhar é do produto e ficou registrado: a coluna
      // `state` é `text` sem CHECK, então o banco aceita um valor que o mapper não sabe ler,
      // e o `OperationStateSchema.parse` estoura em runtime — 500 opaco em vez de erro claro.
      // Fora do escopo do M11; anotado para o M17 (hardening).
      `INSERT INTO operations (operation_id, workspace_id, skill_id, type, state)
       VALUES ($1,$2,$3,'CREATE','ACTIVE')`,
      [operationId, WS_OWNER, skillId],
    );
    await pool.query(
      `INSERT INTO webhook_endpoints (id, workspace_id, url, secret, event_types)
       VALUES ($1,$2,'https://example.invalid/hook','s','["skill.created"]'::jsonb)`,
      [endpointId, WS_OWNER],
    );
  }, 60_000);

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  describe('o intruso recebe 404 (nunca 403, nunca 200)', () => {
    const cases = (): readonly (readonly [string, string, string])[] => [
      ['GET  /v1/skills/:id', 'GET', `/v1/skills/${skillId}`],
      ['GET  /v1/skills/:id/revisions', 'GET', `/v1/skills/${skillId}/revisions`],
      ['GET  /v1/operations/:id', 'GET', `/v1/operations/${operationId}`],
      ['GET  /v1/webhookEndpoints/:id', 'GET', `/v1/webhookEndpoints/${endpointId}`],
      ['DELETE /v1/webhookEndpoints/:id', 'DELETE', `/v1/webhookEndpoints/${endpointId}`],
    ];

    it('todas as rotas por id devolvem 404 para o workspace errado', async () => {
      const app = appAs(WS_INTRUDER);
      const failures: string[] = [];
      for (const [label, method, path] of cases()) {
        const res = await app.request(path, { method });
        if (res.status !== 404) failures.push(`${label} -> ${String(res.status)} (esperado 404)`);
      }
      expect(failures, `rotas que NÃO isolaram:\n${failures.join('\n')}`).toEqual([]);
    });

    it('PATCH /v1/skills/:id do intruso não altera a skill do dono', async () => {
      const res = await appAs(WS_INTRUDER).request(`/v1/skills/${skillId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'sequestrada' }),
      });
      expect(res.status).toBe(404);

      // A prova que importa não é o status — é o estado do banco. Um 404 que mesmo assim
      // gravou seria pior que um 200 honesto.
      const { rows } = await getPool().query<{ description: string }>(
        'SELECT description FROM skills WHERE workspace_id = $1 AND skill_id = $2',
        [WS_OWNER, skillId],
      );
      expect(rows[0]?.description).toBe('skill do dono');
    });

    it('o DONO continua acessando os próprios recursos (o isolamento não cega)', async () => {
      // Contraprova: um handler que devolvesse 404 para todo mundo passaria nos testes acima.
      const app = appAs(WS_OWNER);
      const statuses: Record<string, number> = {};
      for (const [label, method, path] of cases()) {
        statuses[label] = (await app.request(path, { method })).status;
      }
      const notOk = Object.entries(statuses).filter(([, st]) => st >= 400);
      expect(notOk, `o dono foi barrado em: ${JSON.stringify(notOk)}`).toEqual([]);
    });
  });
});
