import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M32 — a rota de ciclo de vida precisa ser alcançável pelo DASHBOARD.
 *
 * MEDIDO em 2026-08-04: `PUT /v1/skills/:id/lifecycle` usava `requireRole('admin')`, que resolve
 * o papel consultando a tabela de MEMBROS pelo `userId` do principal. A credencial que o painel
 * usa é cunhada pelo broker Model B em `/v1/platform/keys`, e ela grava
 * `userId: 'sys_platform_gateway'` — um usuário sintético, deliberadamente NÃO-membro, para não
 * atribuir a atividade do gateway a uma pessoa que não a praticou.
 *
 * Resultado: `roleOf('sys_platform_gateway')` devolve `null`, o gate responde **403**, e a tela
 * de depreciação — o AC5 do milestone — era impossível de construir. A capacidade existia e
 * nenhum consumidor alcançava.
 *
 * O eixo certo aqui é ESCOPO, não papel. Papel governa a administração do workspace (gerenciar
 * membros, cunhar chaves para pessoas); depreciar é curadoria do acervo, a mesma família de
 * `PUT /v1/skills/:id/channels/:channel`, que já usa `skills:publish` — e promover canal é
 * declaradamente a operação MAIS perigosa do produto, porque troca o que os consumidores
 * carregam sem redeploy. Depreciar não faz isso: a DoD exige que a deprecada continue resolvível.
 */
describeIntegration('M32 — o ciclo de vida é alcançável por credencial de workspace', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const appPara = (principal: Principal) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principal,
    });

  async function criarSkill(app: ReturnType<typeof appPara>): Promise<string> {
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skill_id: 'sk_ciclo',
        name: 'Skill de ciclo',
        description: 'para exercitar a depreciação',
        instructions: 'faça algo',
      }),
    });
    expect([200, 201]).toContain(res.status);
    return 'sk_ciclo';
  }

  it('a credencial de GATEWAY (não-membro) consegue depreciar — sem isso a tela é impossível', async () => {
    // Exatamente o principal que o broker Model B produz: workspace real, usuário sintético que
    // NÃO está na tabela de membros.
    const gateway: Principal = {
      workspaceId: 'ws_ciclo',
      userId: 'sys_platform_gateway',
      role: 'admin',
      scopes: ['skills:read', 'skills:publish'],
    };
    const app = appPara(gateway);
    const skillId = await criarSkill(app);

    const res = await app.request(`/v1/skills/${skillId}/lifecycle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycle: 'deprecated', deprecation_reason: 'substituída pela v2' }),
    });

    expect(res.status).toBe(200);
  });

  it('quem só LÊ continua barrado — o gate mudou de eixo, não afrouxou', async () => {
    // A segunda metade que impede a correção de virar "recusa nada". Sem ela, remover o gate
    // inteiro passaria neste arquivo.
    const leitor: Principal = {
      workspaceId: 'ws_ciclo',
      userId: 'sys_platform_gateway',
      role: 'member',
      scopes: ['skills:read'],
    };
    const publisher = appPara({
      workspaceId: 'ws_ciclo',
      userId: 'sys_platform_gateway',
      role: 'admin',
      scopes: ['skills:read', 'skills:publish'],
    });
    const skillId = await criarSkill(publisher);

    const res = await appPara(leitor).request(`/v1/skills/${skillId}/lifecycle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycle: 'deprecated', deprecation_reason: 'tentativa sem escopo' }),
    });

    expect(res.status).toBe(403);
  });
});
