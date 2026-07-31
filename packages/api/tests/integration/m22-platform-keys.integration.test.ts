import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { API_KEY_PREFIX } from '../../src/server/auth/oidc-verifier.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M22 — cunhagem de PLATAFORMA: `POST /v1/platform/keys`.
 *
 * POR QUE UMA ROTA SEPARADA, e não um caso especial da de admin.
 *
 * `POST /v1/admin/keys` deriva o workspace do PRINCIPAL do chamador e exige que o alvo seja
 * membro dele — é a rota de um humano administrando o próprio time, e o teto de privilégio
 * (anti-escalation) nasce ali. Não há como o control plane usá-la para cunhar em QUALQUER
 * tenant, que é justamente o que o modelo de broker exige.
 *
 * Colapsar os dois casos numa rota só significaria enfraquecer as checagens de membro e de
 * escalada para um caminho, e uma verificação de segurança com um "a menos que" é a que se
 * esquece de auditar. Rotas distintas, credenciais distintas, semânticas distintas.
 *
 * A credencial de plataforma vive SÓ no control plane e nunca no caminho de dados — é a
 * separação control/data plane que fecha o confused deputy. Aqui verificamos o contrato dela.
 */

const PLATAFORMA = 'plat_segredo_de_teste_com_tamanho_bom';

describeIntegration('M22 — cunhagem de plataforma', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const app = (platformKey?: string) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      ...(platformKey !== undefined ? { platformAdminKey: platformKey } : {}),
    });

  const cunhar = (corpo: unknown, credencial?: string, platformKey = PLATAFORMA) =>
    app(platformKey).request('/v1/platform/keys', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(credencial !== undefined ? { authorization: `Bearer ${credencial}` } : {}),
      },
      body: JSON.stringify(corpo),
    });

  it('cunha uma chave para um tenant ARBITRÁRIO — o que a rota de admin não permite', async () => {
    const res = await cunhar({ workspace_id: 'ws_cliente_novo', scopes: ['skills:read'] }, PLATAFORMA);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { key_id: string; workspace_id: string; scopes: string[]; token: string };
    expect(body.workspace_id).toBe('ws_cliente_novo');
    expect(body.scopes).toEqual(['skills:read']);
    // Derivado da constante, não repetido como literal: um prefixo escrito à mão aqui
    // divergiria do código na primeira vez que ele mudasse, e o teste continuaria verde
    // sobre a expectativa antiga.
    expect(body.token, 'o token é devolvido uma única vez').toMatch(new RegExp(`^${API_KEY_PREFIX}`));

    // O que persiste é o HASH — um dump do banco não autentica ninguém.
    const { rows } = await getPool().query<{ token_hash: string; workspace_id: string }>(
      'SELECT token_hash, workspace_id FROM api_keys WHERE key_id = $1',
      [body.key_id],
    );
    expect(rows[0]?.workspace_id).toBe('ws_cliente_novo');
    expect(rows[0]?.token_hash).not.toBe(body.token);
  });

  it('a chave cunhada AUTENTICA e vê apenas o próprio tenant', async () => {
    // A prova de que a cunhagem serve para alguma coisa: o segredo devolvido tem que passar
    // pelo verificador de verdade. Uma rota que devolve token inválido "funciona" nos testes
    // dela e falha no primeiro uso real.
    const res = await cunhar({ workspace_id: 'ws_prova', scopes: ['skills:read'] }, PLATAFORMA);
    const { token } = (await res.json()) as { token: string };

    const { createApiKeyVerifier } = await import('../../src/server/auth/api-key-verifier.js');
    const { createApiKeysStore } = await import('../../src/server/store/api-keys-store.js');
    const { createDb } = await import('../../src/server/db.js');

    const principal = await createApiKeyVerifier(createApiKeysStore(createDb(getPool()))).resolvePrincipal(token);
    expect(principal?.workspaceId).toBe('ws_prova');
    expect(principal?.scopes).toEqual(['skills:read']);
  });

  it('SEM credencial de plataforma: 401', async () => {
    expect((await cunhar({ workspace_id: 'ws_x', scopes: ['skills:read'] })).status).toBe(401);
  });

  it('credencial ERRADA: 401 — e nunca 403, que confirmaria a rota a quem tenta', async () => {
    expect((await cunhar({ workspace_id: 'ws_x', scopes: ['skills:read'] }, 'plat_errada')).status).toBe(401);
  });

  it('uma chave de USUÁRIO comum não serve como credencial de plataforma', async () => {
    // A separação control/data plane só existe se o segredo do caminho de dados NÃO abrir a
    // porta de provisionamento. Sem esta guarda, qualquer chave vazada viraria minter.
    const pool = getPool();
    await pool.query('INSERT INTO users (user_id,email) VALUES ($1,$2)', ['u_x', 'x@p.dev']);
    await pool.query(
      `INSERT INTO api_keys (key_id, workspace_id, user_id, token_hash, scopes)
       VALUES ('key_x','ws_x','u_x', encode(sha256('tsk_chave_de_usuario'::bytea),'hex'), '["skills:admin"]')`,
    );
    expect((await cunhar({ workspace_id: 'ws_x', scopes: ['skills:read'] }, 'tsk_chave_de_usuario')).status).toBe(401);
  });

  it('DESLIGADA quando a credencial de plataforma não está configurada — fail-closed', async () => {
    // Sem o segredo no ambiente a rota não existe: 404. Um serviço que expõe provisionamento
    // por omissão é pior que um que não o expõe.
    const res = await app().request('/v1/platform/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer qualquer' },
      body: JSON.stringify({ workspace_id: 'ws_x', scopes: ['skills:read'] }),
    });
    expect(res.status).toBe(404);
  });

  it('workspace_id vazio é 400 — nunca cunha contra o tenant ""', async () => {
    expect((await cunhar({ workspace_id: '', scopes: ['skills:read'] }, PLATAFORMA)).status).toBe(400);
    expect((await cunhar({ scopes: ['skills:read'] }, PLATAFORMA)).status).toBe(400);
  });

  it('escopo desconhecido é 400 EXPLÍCITO — nunca descartado em silêncio', async () => {
    // Descartar entregaria uma chave com menos poder que o pedido, e a falha apareceria
    // depois como um 403 inexplicável no cliente. Mesma regra da rota de admin.
    expect((await cunhar({ workspace_id: 'ws_x', scopes: ['skills:read', 'inventado'] }, PLATAFORMA)).status).toBe(400);
  });

  it('lista de escopos vazia é 400 — chave sem poder algum é lixo com validade', async () => {
    expect((await cunhar({ workspace_id: 'ws_x', scopes: [] }, PLATAFORMA)).status).toBe(400);
  });

  it('NÃO exige que o alvo seja membro — é justamente a diferença para a rota de admin', async () => {
    // A rota de admin devolve 422 para não-membro, e está certa: lá existe um humano alvo.
    // Aqui o titular é o próprio gateway; exigir membro obrigaria o control plane a criar
    // usuário em cada tenant antes de conseguir falar com ele.
    const res = await cunhar({ workspace_id: 'ws_sem_membros', scopes: ['skills:read'] }, PLATAFORMA);
    expect(res.status).toBe(201);
  });
});
