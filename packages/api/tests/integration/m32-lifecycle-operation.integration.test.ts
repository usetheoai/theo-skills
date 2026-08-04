import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, type Principal } from '@usetheo/skills';
import { type Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { type Logger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';
import { createMembersStore } from '../../src/server/store/members-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M32 — `PUT /v1/skills/:id/lifecycle`, a operação de curadoria.
 *
 * O que ela protege: deprecar sem motivo. O registry investigado não tem motivo nem sucessora —
 * lá, descontinuar é trocar uma string, e o agente que recebe "deprecada" fica sabendo que
 * parou sem saber o que fazer. Esta rota recusa esse estado.
 */

const WS = 'ws_m32_op';
const stubQueue = {} as unknown as PgBoss;

// A rota exige `admin`: deprecar muda o que TODOS os agentes do workspace conseguem descobrir,
// pelo mesmo motivo que promover visibilidade exige — é curadoria, não auto-serviço.
const adminPrincipal: Principal = {
  workspaceId: WS,
  userId: 'u_admin',
  role: 'member',
  scopes: ['skills:admin'],
};
const logs: { fields: Record<string, unknown>; msg: string }[] = [];
const capturingLogger: Logger = {
  info: (fields, msg) => logs.push({ fields, msg }),
  error: () => undefined,
};

async function seed(skillId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
     VALUES ($4,$1,$2,'fixture',$3,$2)`,
    [skillId, skillId, `rev_${createId()}`, WS],
  );
}

async function put(app: Hono<AppEnv>, id: string, body: unknown): Promise<Response> {
  return app.request(`/v1/skills/${id}/lifecycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describeIntegration('M32 — PUT /v1/skills/:id/lifecycle', () => {
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    await truncateAll();
    logs.length = 0;
    await getPool().query("INSERT INTO users (user_id, email) VALUES ('u_admin','a@p.dev')");
    await createMembersStore(createDb(getPool()), WS).upsert('u_admin', 'admin');
    app = createApp({
      pool: getPool(),
      queue: stubQueue,
      logger: capturingLogger,
      embedder: createStubEmbedder(),
      principalResolver: () => adminPrincipal,
    });
    await seed('op-alvo');
    await seed('op-sucessora');
  });

  afterAll(closePool);

  it('deprecar sem motivo é recusado, nomeando o campo', async () => {
    const res = await put(app, 'op-alvo', { lifecycle: 'deprecated' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field: string };
    expect(body.error).toBe('invalid_request');
    // Nomear o campo é o que permite a tela posicionar o erro no lugar certo em vez de
    // mostrar um toast genérico.
    expect(body.field).toBe('reason');
  });

  it('deprecar com motivo grava o estágio e o motivo', async () => {
    const res = await put(app, 'op-alvo', {
      lifecycle: 'deprecated',
      reason: 'consolidada na op-sucessora',
      superseded_by: 'op-sucessora',
    });
    expect(res.status).toBe(200);

    const { rows } = await getPool().query<{
      lifecycle: string;
      deprecation_reason: string | null;
      superseded_by: string | null;
    }>(
      'SELECT lifecycle, deprecation_reason, superseded_by FROM skills WHERE workspace_id = $2 AND skill_id = $1',
      ['op-alvo', WS],
    );
    expect(rows[0]).toEqual({
      lifecycle: 'deprecated',
      deprecation_reason: 'consolidada na op-sucessora',
      superseded_by: 'op-sucessora',
    });
  });

  it('a sucessora precisa existir', async () => {
    const res = await put(app, 'op-alvo', {
      lifecycle: 'deprecated',
      reason: 'x',
      superseded_by: 'nao-existe',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe('superseded_by');
  });

  it('uma skill não pode suceder a si mesma', async () => {
    const res = await put(app, 'op-alvo', {
      lifecycle: 'deprecated',
      reason: 'x',
      superseded_by: 'op-alvo',
    });
    expect(res.status).toBe(400);
  });

  it('estágio fora do vocabulário é recusado com a lista de aceitos', async () => {
    const res = await put(app, 'op-alvo', { lifecycle: 'aposentada' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string; details: string };
    expect(body.field).toBe('lifecycle');
    // O erro vem do domínio e enumera o vocabulário — quem lê não precisa da documentação.
    expect(body.details).toContain('active');
  });

  it('sair de deprecated LIMPA motivo e sucessora', async () => {
    await put(app, 'op-alvo', {
      lifecycle: 'deprecated',
      reason: 'temporária',
      superseded_by: 'op-sucessora',
    });
    const res = await put(app, 'op-alvo', { lifecycle: 'active' });
    expect(res.status).toBe(200);

    const { rows } = await getPool().query<{
      lifecycle: string;
      deprecation_reason: string | null;
      superseded_by: string | null;
    }>(
      'SELECT lifecycle, deprecation_reason, superseded_by FROM skills WHERE workspace_id = $2 AND skill_id = $1',
      ['op-alvo', WS],
    );
    // Manter o motivo afirmaria que a skill está descontinuada por uma razão quando ela não
    // está mais descontinuada.
    expect(rows[0]).toEqual({ lifecycle: 'active', deprecation_reason: null, superseded_by: null });
  });

  it('skill inexistente devolve 404, não 403 — não enumera o acervo alheio', async () => {
    const res = await put(app, 'nunca-existiu', { lifecycle: 'draft' });
    expect(res.status).toBe(404);
  });

  it('a mudança é auditada com ator, skill e estágio', async () => {
    await put(app, 'op-alvo', { lifecycle: 'draft' });
    const linha = logs.find((l) => l.msg === 'skill.lifecycle.changed');
    expect(linha).toBeDefined();
    expect(linha?.fields['skill_id']).toBe('op-alvo');
    expect(linha?.fields['lifecycle']).toBe('draft');
  });

  it('motivo acima do teto é recusado', async () => {
    const res = await put(app, 'op-alvo', {
      lifecycle: 'deprecated',
      reason: 'x'.repeat(501),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe('reason');
  });
});
