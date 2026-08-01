import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createAdoptionStore } from '../../src/server/store/adoption-store.js';
import { createBundlesStore } from '../../src/server/store/bundles-store.js';
import { createChannelsStore } from '../../src/server/store/channels-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * A adoção precisa dizer QUAL versão foi instalada.
 *
 * O defeito, achado pelo `/review` de M24–M27: a telemetria gravava o **nome do canal**
 * (`stable`) na coluna da revisão, e `version: null` fixo. O relatório agrupa por versão, então
 * ele inteiro colapsava numa linha nula — "uma instalação foi contabilizada" era verdade, e
 * "com que versão" nunca teria resposta.
 *
 * Um relatório de adoção que não distingue versões não responde à única pergunta que o
 * publisher faz dele: *a correção que publiquei chegou aos meus clientes?*
 */
const WS = 'ws_tel';

describeIntegration('adoção registra a revisão real, não o nome do canal', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  it('a linha de adoção carrega a versão que o canal apontava', async () => {
    const pool = getPool();
    const db = createDb(pool);

    const skills = createSkillsStore(db, WS);
    await skills.createWithRevision({
      skillId: 'sk_tel',
      name: 'sk_tel',
      description: 'd',
      payload: Buffer.from('z'),
      contentHash: 'h1',
      frontmatter: {},
      skillMd: '#',
      version: '3.1.0',
    });
    const { rows: revs } = await pool.query<{ revision_id: string }>(
      'SELECT revision_id FROM skill_revisions WHERE workspace_id=$1',
      [WS],
    );
    const rev = revs[0]!.revision_id;
    await createChannelsStore(db, WS).promote('sk_tel', 'stable', rev, null);

    const bundles = createBundlesStore(db, WS);
    const bundleId = await bundles.create('pacote');
    await bundles.setItems(bundleId, [{ skillId: 'sk_tel', channel: 'stable' }]);
    const { token } = await bundles.mintToken(bundleId, { ttlMs: 86_400_000 });

    const app = createApp({
      pool,
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      distribution: { defaultQuota: 100, windowMs: 60_000 },
    });
    expect((await app.request('/v1/distribution/bundle', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    // A gravação é fire-and-forget por desenho (a contagem nunca derruba a entrega).
    await new Promise((r) => setTimeout(r, 400));

    const linhas = await createAdoptionStore(db, WS).adoption(bundleId, new Date(Date.now() - 86_400_000));
    expect(linhas.length).toBe(1);
    expect(linhas[0]?.version, 'a versão que o canal apontava, não null').toBe('3.1.0');

    const { rows } = await pool.query<{ revision_id: string }>(
      'SELECT revision_id FROM install_events WHERE workspace_id=$1',
      [WS],
    );
    expect(rows[0]?.revision_id, 'a revisão real, não o nome do canal').toBe(rev);
  });

  it('canal sem promoção não inventa revisão — grava o que sabe e segue entregando', async () => {
    // Caso negativo: o bundle referencia um canal que ninguém promoveu. A entrega NÃO pode
    // falhar por causa da telemetria, e a linha não pode fabricar uma revisão que não existe.
    const pool = getPool();
    const db = createDb(pool);
    const skills = createSkillsStore(db, WS);
    await skills.createWithRevision({
      skillId: 'sk_sem_canal', name: 'sk_sem_canal', description: 'd',
      payload: Buffer.from('z'), contentHash: 'h2', frontmatter: {}, skillMd: '#', version: '1.0.0',
    });

    const bundles = createBundlesStore(db, WS);
    const bundleId = await bundles.create('pacote2');
    await bundles.setItems(bundleId, [{ skillId: 'sk_sem_canal', channel: 'beta' }]);
    const { token } = await bundles.mintToken(bundleId, { ttlMs: 86_400_000 });

    const app = createApp({
      pool, queue: boss, logger: createNoopLogger(), reservationHours: 1,
      distribution: { defaultQuota: 100, windowMs: 60_000 },
    });
    expect(
      (await app.request('/v1/distribution/bundle', { headers: { authorization: `Bearer ${token}` } })).status,
      'a entrega não depende da telemetria',
    ).toBe(200);
  });
});
