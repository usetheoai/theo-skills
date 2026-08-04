import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * A adoção é dado do PUBLISHER e deve exigir o escopo do publisher.
 *
 * MEDIDO em 2026-08-04: toda rota de bundle passa por `requireScope('skills:publish')` —
 * `POST /v1/bundles`, `GET /v1/bundles`, e as três de token. A de adoção, não: `app.ts:223`
 * monta `registerAdoptionRoutes` sem gate, e o handler só confere que existe um principal.
 *
 * Consequência: um portador de `skills:read` — o escopo que o dashboard cunha para o cliente
 * de LEITURA, e o que um agente consumidor carrega — lê a telemetria comercial de quem publica.
 * Mesmo workspace, então não é vazamento entre inquilinos; é privilégio a mais dentro dele, e a
 * assimetria com as rotas irmãs mostra que não foi decisão, foi esquecimento.
 */
describeIntegration('M35 — escopo da adoção', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const comEscopos = (scopes: string[]) => {
    const principal: Principal = { workspaceId: 'ws_pub', userId: 'u', role: 'admin', scopes };
    return createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      distribution: { defaultQuota: 600, windowMs: 60_000 },
      principalResolver: () => principal,
    });
  };

  it('quem só lê NÃO enxerga a adoção — é dado de quem publica', async () => {
    const publisher = comEscopos(['skills:publish']);
    const criar = await publisher.request('/v1/bundles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pacote' }),
    });
    const { bundle_id } = (await criar.json()) as { bundle_id: string };

    // Mesmo workspace, escopo de leitura apenas.
    const leitor = comEscopos(['skills:read']);
    const res = await leitor.request(`/v1/bundles/${bundle_id}/adoption?days=30`);

    expect(res.status).toBe(403);
  });

  it('e a assimetria fica explícita: o mesmo leitor já é barrado nos tokens', async () => {
    // Este passa HOJE. Existe para provar que o 403 acima é o comportamento das irmãs, não
    // uma regra nova que estou inventando para a rota de adoção.
    const leitor = comEscopos(['skills:read']);
    const res = await leitor.request('/v1/bundles/bdl_qualquer/tokens');
    expect(res.status).toBe(403);
  });

  it('o publisher continua enxergando a própria adoção', async () => {
    const publisher = comEscopos(['skills:publish']);
    const criar = await publisher.request('/v1/bundles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pacote' }),
    });
    const { bundle_id } = (await criar.json()) as { bundle_id: string };

    const res = await publisher.request(`/v1/bundles/${bundle_id}/adoption?days=30`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total_installs: number }).total_installs).toBe(0);
  });
});
