import { createId } from '@paralleldrive/cuid2';
import { type Principal } from '@usetheo/skills';
import type PgBoss from 'pg-boss';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M32 — a rota de ciclo de vida precisa ser alcançável pelo DASHBOARD.
 *
 * MEDIDO em 2026-08-04, ao construir a tela: `PUT /v1/skills/:id/lifecycle` usava
 * `requireRole('admin')`, que resolve o papel consultando a tabela de MEMBROS pelo `userId` do
 * principal. A credencial que o painel usa é cunhada pelo broker Model B em `/v1/platform/keys`,
 * e ela grava `userId: 'sys_platform_gateway'` — um usuário sintético, deliberadamente NÃO-membro,
 * para não atribuir a atividade do gateway a uma pessoa que não a praticou
 * (`platform-keys.ts:19-22`).
 *
 * Consequência: `roleOf('sys_platform_gateway')` devolve `null`, o gate responde **403**, e a tela
 * de depreciação — o AC5 deste milestone — era impossível de construir. A capacidade existia no
 * serviço e **nenhum consumidor a alcançava**.
 *
 * O eixo certo aqui é ESCOPO, não papel:
 *
 *  - papel governa a administração do WORKSPACE — gerenciar membros, cunhar chaves para pessoas —
 *    onde a pergunta "quem é você aqui dentro" faz sentido;
 *  - depreciar é curadoria do ACERVO, a mesma família de `PUT /v1/skills/:id/channels/:channel`,
 *    que já usa `skills:publish`.
 *
 * E promover canal é declaradamente a operação **mais perigosa** do produto — troca o que os
 * consumidores carregam, sem redeploy. Depreciar não faz isso: a própria DoD exige que a skill
 * deprecada continue resolvível para quem já a referencia. Exigir MAIS para o ato menos perigoso
 * era a inversão que este teste corrige.
 */

const stubQueue = {} as unknown as PgBoss;

async function seed(skillId: string): Promise<void> {
  const revisionId = `rev_${createId()}`;
  await getPool().query(
    `INSERT INTO skills (skill_id, name, description, latest_revision_id, search_text, lifecycle, enabled)
     VALUES ($1,$2,$3,$4,$5,'active',true)`,
    [skillId, skillId, 'skill para exercitar a depreciação', revisionId, `${skillId} depreciação`],
  );
  await getPool().query(
    `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1,$2,'\\x00','h','{}'::jsonb,$3)`,
    [revisionId, skillId, 'conteúdo'],
  );
}

describeIntegration('M32 — o ciclo de vida é alcançável por credencial de workspace', () => {
  beforeEach(async () => {
    await truncateAll();
    await seed('lc-alcance');
  });
  afterAll(closePool);

  const appPara = (principal: Principal) =>
    createApp({
      pool: getPool(),
      queue: stubQueue,
      logger: createNoopLogger(),
      principalResolver: () => principal,
    });

  const gateway = (scopes: string[]): Principal =>
    ({
      workspaceId: 'default',
      // Exatamente o que o broker Model B produz: usuário sintético que NÃO está na tabela de
      // membros. É esse detalhe que o `requireRole` derrubava.
      userId: 'sys_platform_gateway',
      role: 'admin',
      scopes,
    }) as Principal;

  it('a credencial de GATEWAY (não-membro) consegue depreciar — sem isso a tela é impossível', async () => {
    const res = await appPara(gateway(['skills:read', 'skills:publish'])).request(
      '/v1/skills/lc-alcance/lifecycle',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lifecycle: 'deprecated', reason: 'substituída pela v2' }),
      },
    );

    expect(res.status).toBe(200);
  });

  it('quem só LÊ continua barrado — o gate mudou de eixo, não afrouxou', async () => {
    // A segunda metade que impede a correção de virar "recusa nada". Sem ela, remover o gate
    // inteiro passaria neste arquivo — e recusa cega é indistinguível de segurança.
    const res = await appPara(gateway(['skills:read'])).request('/v1/skills/lc-alcance/lifecycle', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycle: 'deprecated', reason: 'tentativa sem escopo' }),
    });

    expect(res.status).toBe(403);
  });
});
