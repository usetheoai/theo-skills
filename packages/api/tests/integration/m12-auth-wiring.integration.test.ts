import { type AuthVerifier, type Principal } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M12 — o WIRING, que é o que separa "o auth existe" de "as rotas estão protegidas".
 *
 * Os testes de contrato provam o middleware isoladamente. Este prova que ele está LIGADO:
 * um app construído com `authVerifier` recusa quem não tem credencial em rota real, e o
 * workspace usado nas consultas vem da credencial — não do `DEFAULT_PRINCIPAL`.
 */

const principalOf = (workspaceId: string): Principal => ({
  workspaceId,
  userId: 'u_auth',
  role: 'member',
  scopes: ['skills:admin'],
});

describeIntegration('M12 — auth ligado às rotas reais', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeAll(async () => {
    boss = await startBoss();
    await truncateAll();
    // Uma skill do workspace 'ws_token' — só alcançável por quem apresentar a credencial dele.
    await getPool().query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
       VALUES ('ws_token','sk_owned','owned','descricao','rev_1','owned descricao')`,
    );
  }, 60_000);

  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const verifier: AuthVerifier = {
    resolvePrincipal: (t: string) =>
      Promise.resolve(t === 'tok_valido' ? principalOf('ws_token') : t === 'tok_outro' ? principalOf('ws_outro') : null),
  };

  const appAuthed = () =>
    createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), reservationHours: 1, authVerifier: verifier });

  it('sem credencial: rota real devolve 401 (a porta está fechada)', async () => {
    const res = await appAuthed().request('/v1/skills');
    expect(res.status).toBe(401);
  });

  it('credencial inválida devolve 401', async () => {
    const res = await appAuthed().request('/v1/skills', { headers: { authorization: 'Bearer lixo' } });
    expect(res.status).toBe(401);
  });

  it('credencial válida: o workspace vem DA CREDENCIAL, não do default', async () => {
    // A prova que importa: o dono vê a própria skill…
    const dono = await appAuthed().request('/v1/skills', { headers: { authorization: 'Bearer tok_valido' } });
    expect(dono.status).toBe(200);
    const body = (await dono.json()) as { skills: { skill_id: string }[] };
    expect(body.skills.map((s) => s.skill_id)).toContain('sk_owned');

    // …e outro tenant, com credencial igualmente VÁLIDA, não vê nada.
    const outro = await appAuthed().request('/v1/skills', { headers: { authorization: 'Bearer tok_outro' } });
    const outroBody = (await outro.json()) as { skills: { skill_id: string }[] };
    expect(outroBody.skills).toEqual([]);
  });

  it('/v1/health e /v1/version continuam abertos — monitoramento não carrega credencial', async () => {
    // Se o painel de status precisasse de credencial, "o serviço caiu" e "minha credencial
    // está errada" produziriam a mesma resposta, e quem monitora não separaria os dois.
    // Esta é a decisão registrada no CHANGELOG do /v1/version; o teste a trava.
    for (const rota of ['/v1/health', '/v1/version']) {
      const res = await appAuthed().request(rota);
      expect(res.status, `${rota} exigiu credencial`).toBe(200);
    }
  });

  it('SEM authVerifier o bridge legado permanece — instalação existente não quebra', async () => {
    const app = createApp({ pool: getPool(), queue: boss, logger: createNoopLogger(), reservationHours: 1 });
    const res = await app.request('/v1/skills');
    expect(res.status).toBe(200);
  });
});
