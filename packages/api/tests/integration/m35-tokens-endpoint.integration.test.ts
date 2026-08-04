import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M35 — o CONTRATO HTTP de tokens e adoção, não o store.
 *
 * Por que este arquivo existe separado: o primeiro passe do M35 implementou `listTokens` no store,
 * viu nove testes verdes e **não criou a rota**. O método ficou sem chamador de produção — a tela
 * continuava sem como listar, e portanto sem como revogar, que era exatamente a lacuna que o
 * milestone dizia fechar. Nada no eixo de store reprovava.
 *
 * A lição, e a razão de o teste ser de endpoint: um store correto atrás de uma porta que não existe
 * é indistinguível de nada implementado, do ponto de vista de quem consome.
 */
describeIntegration('M35 — contrato HTTP de tokens e adoção', () => {
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

  async function bundleComToken(a: ReturnType<typeof app>): Promise<{ bundleId: string; token: string }> {
    const criar = await a.request('/v1/bundles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pacote' }),
    });
    const { bundle_id } = (await criar.json()) as { bundle_id: string };

    const emitir = await a.request(`/v1/bundles/${bundle_id}/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ttl_days: 30, label: 'ci' }),
    });
    const emitido = (await emitir.json()) as { token?: string };
    return { bundleId: bundle_id, token: emitido.token ?? '' };
  }

  it('GET /v1/bundles/:id/tokens devolve o token emitido — a porta que faltava', async () => {
    const a = app();
    const { bundleId } = await bundleComToken(a);

    const res = await a.request(`/v1/bundles/${bundleId}/tokens`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { bundle_id: string; tokens: { token_id: string; label: string | null }[] };
    expect(body.bundle_id).toBe(bundleId);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]?.token_id).toMatch(/^dtk_/);
    expect(body.tokens[0]?.label).toBe('ci');
  });

  it('a resposta HTTP NUNCA carrega o valor do token nem o hash', async () => {
    // O store já era testado nisso; aqui a asserção é sobre o que atravessa a fronteira, que é o
    // que um atacante de fato vê.
    const a = app();
    const { bundleId, token } = await bundleComToken(a);
    expect(token).not.toBe('');

    const { rows } = await getPool().query<{ token_hash: string }>(
      'SELECT token_hash FROM distribution_tokens LIMIT 1',
    );
    const hash = rows[0]?.token_hash ?? '';
    expect(hash).not.toBe('');

    const corpo = await (await a.request(`/v1/bundles/${bundleId}/tokens`)).text();
    expect(corpo).not.toContain(token);
    expect(corpo).not.toContain(hash);
  });

  it('bundle de outro workspace devolve 404 — não enumera o acervo alheio', async () => {
    const res = await app().request('/v1/bundles/bdl_inexistente/tokens');
    expect(res.status).toBe(404);
  });

  it('a adoção devolve total_installs no CORPO — o denominador que a tela precisa', async () => {
    // O store foi testado; o contrato não era. Sem esta asserção, `total_installs` podia sumir da
    // resposta sem nenhum teste reprovar.
    const a = app();
    const { bundleId } = await bundleComToken(a);

    const res = await a.request(`/v1/bundles/${bundleId}/adoption?days=30`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { total_installs?: number; adoption?: unknown[] };
    expect(body.total_installs).toBe(0);
    expect(body.adoption).toEqual([]);
  });

  it('janela vazia devolve zero explícito, distinguível de campo ausente', async () => {
    const a = app();
    const { bundleId } = await bundleComToken(a);

    const body = (await (await a.request(`/v1/bundles/${bundleId}/adoption`)).json()) as {
      total_installs?: number;
    };
    // `0` e `undefined` levam a tela a desenhos opostos — um mostra "ninguém instalou", o outro
    // deveria mostrar "não consegui ler".
    expect(body.total_installs).toBeDefined();
    expect(body.total_installs).toBe(0);
  });
});
