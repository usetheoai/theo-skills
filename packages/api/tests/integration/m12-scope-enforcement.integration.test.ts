import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

/**
 * M12 — o escopo passa a valer na ESCRITA.
 *
 * `requireScope` existia, tinha teste de contrato, e **não estava aplicado a nenhuma rota**:
 * uma chave `skills:read` publicava e apagava como qualquer outra. Os escopos eram
 * decorativos — o vocabulário existia e não governava nada.
 *
 * A distinção que isto restaura: **papel** governa PERTENCIMENTO (quem é do workspace),
 * **escopo** governa CAPACIDADE (o que aquela credencial pode fazer). Sem a segunda, uma
 * chave emitida para leitura carregava poder de escrita.
 */
const principalCom = (scopes: string[]): Principal => ({
  workspaceId: 'ws_escopo',
  userId: 'u_escopo',
  role: 'member',
  scopes: scopes as Principal['scopes'],
});

describeIntegration('M12 — escopo governa a escrita', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const appCom = (scopes: string[]) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalCom(scopes),
    });

  const publicar = async (scopes: string[]) => {
    const zip = await buildZipBase64([{ path: 'SKILL.md', content: skillMd('escopada', 'Faz X. Use quando Y.') }]);
    return appCom(scopes).request('/v1/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: 'escopada', zippedFilesystem: zip }),
    });
  };

  it('chave SÓ-LEITURA é recusada na publicação (403)', async () => {
    expect((await publicar(['skills:read'])).status).toBe(403);
  });

  it('chave com `skills:write` publica (202)', async () => {
    expect((await publicar(['skills:write'])).status).toBe(202);
  });

  it('`skills:admin` implica escrita — a cadeia de escopos vale', async () => {
    // Exigir que um admin declare `skills:write` explicitamente seria burocracia que ninguém
    // lembra de cumprir; a implicação está na tabela de escopos e é testada aqui de ponta.
    expect((await publicar(['skills:admin'])).status).toBe(202);
  });

  it('a LEITURA continua aberta a quem só tem leitura', async () => {
    // O escopo restringe a capacidade, não fecha a porta: uma chave de leitura deve ler.
    expect((await appCom(['skills:read']).request('/v1/skills')).status).toBe(200);
  });

  it('DELETE também exige escrita', async () => {
    expect((await appCom(['skills:read']).request('/v1/skills/escopada', { method: 'DELETE' })).status).toBe(403);
  });
});
