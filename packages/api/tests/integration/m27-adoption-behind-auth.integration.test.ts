import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M27 — a adoção estava do LADO ERRADO da fronteira de autenticação.
 *
 * As rotas de distribuição são registradas ANTES do middleware de auth, e com razão: quem as
 * consome é o cliente de um publisher, que não é membro de workspace algum e não tem
 * Principal. A rota de ADOÇÃO foi junto por proximidade de domínio — mas ela lê
 * `c.get('principal')`, que naquele ponto do pipeline ainda não foi resolvido.
 *
 * O resultado era um **404 permanente**: nunca um erro, nunca um log, apenas um publisher
 * que via seu próprio bundle responder "não existe". Medido contra o serviço no ar.
 */
describeIntegration('M27 — adoção vive atrás da autenticação', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const principal: Principal = {
    workspaceId: 'ws_pub',
    userId: 'u_pub',
    role: 'admin',
    scopes: ['skills:admin'],
  };

  const app = () =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      distribution: { defaultQuota: 600, windowMs: 60_000 },
      principalResolver: () => principal,
    });

  it('o publisher lê a adoção do PRÓPRIO bundle — 200, não 404', async () => {
    const a = app();
    const criar = await a.request('/v1/bundles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pacote' }),
    });
    const { bundle_id } = (await criar.json()) as { bundle_id: string };

    const res = await a.request(`/v1/bundles/${bundle_id}/adoption`);
    expect(res.status, 'o dono do bundle enxerga a própria adoção').toBe(200);
    const body = (await res.json()) as { bundle_id: string; adoption: unknown[] };
    expect(body.bundle_id).toBe(bundle_id);
    expect(Array.isArray(body.adoption), 'sem instalações ainda: lista vazia, não erro').toBe(true);
  });

  it('a rota de DISTRIBUIÇÃO continua servindo o consumidor sem Principal — a razão do desenho', async () => {
    // A separação só é correta se a outra metade seguir funcionando: o consumidor apresenta
    // credencial de distribuição, não é membro de nada, e não pode depender do middleware
    // interno. Sem esta asserção, "mover para trás do auth" poderia levar as duas juntas —
    // e o sintoma seria o cliente de um publisher deixando de receber o catálogo.
    //
    // A prova é o caminho FELIZ com credencial real, não um 401 sobre credencial inválida:
    // a rota devolve 404 a token inválido POR DESENHO (não-enumeração, mesmo contrato do
    // M11), e 404 é exatamente o que uma rota não registrada também devolveria.
    const a = app();
    const criar = await a.request('/v1/bundles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pacote-do-consumidor' }),
    });
    const { bundle_id } = (await criar.json()) as { bundle_id: string };
    const cunhar = await a.request(`/v1/bundles/${bundle_id}/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ttl_days: 7, label: 'consumidor' }),
    });
    const { token } = (await cunhar.json()) as { token: string };

    const res = await a.request('/v1/distribution/bundle', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status, 'o consumidor recebe o catálogo sem ser membro de nada').toBe(200);
    expect(((await res.json()) as { bundle_id: string }).bundle_id).toBe(bundle_id);
  });
});
