import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createAdoptionStore } from '../../src/server/store/adoption-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M21 — telemetria de adoção para o publisher.
 *
 * O risco declarado do milestone é que estes dados são **informação de negócio de terceiro**:
 * saber que o cliente X do publisher A instalou a skill Y é competitivamente sensível. O
 * isolamento aqui não é higiene, é a diferença entre um painel útil e um vazamento.
 */

const PUB_A = 'ws_pub_a';
const PUB_B = 'ws_pub_b';

describeIntegration('M21 — adoção por publisher', () => {
  const a = () => createAdoptionStore(createDb(getPool()), PUB_A);
  const b = () => createAdoptionStore(createDb(getPool()), PUB_B);
  const ontem = () => new Date(Date.now() - 86_400_000);

  beforeEach(truncateAll);
  afterAll(closePool);

  const ev = (over: Partial<Parameters<ReturnType<typeof a>['record']>[0]> = {}) => ({
    bundleId: 'bdl_1',
    tokenId: 'dtk_1',
    skillId: 'sk_1',
    revisionId: 'rev_1',
    version: '1.0.0',
    ...over,
  });

  it('agrega instalações por skill e por VERSÃO', async () => {
    const s = a();
    await s.record(ev());
    await s.record(ev());
    await s.record(ev({ version: '2.0.0', revisionId: 'rev_2' }));
    await s.record(ev({ skillId: 'sk_2' }));

    const rows = await s.adoption('bdl_1', ontem());
    const porChave = new Map(rows.map((r) => [`${r.skillId}@${r.version ?? '-'}`, r.installs]));
    expect(porChave.get('sk_1@1.0.0')).toBe(2);
    expect(porChave.get('sk_1@2.0.0')).toBe(1);
    expect(porChave.get('sk_2@1.0.0')).toBe(1);
  });

  it('ISOLAMENTO: o publisher B não vê a adoção de A — nem os totais', async () => {
    // Vazamento por DIFERENÇA de contagem agregada é o caso sutil: um filtro aplicado só na
    // leitura final deixaria passar, bastando comparar dois totais para inferir a atividade
    // do vizinho. O escopo estrutural na construção do store é o que fecha isso.
    await a().record(ev());
    await a().record(ev());

    expect(await b().adoption('bdl_1', ontem())).toEqual([]);
    expect(await b().countSince(ontem()), 'B inferiu a atividade de A pelo total').toBe(0);
    expect(await a().countSince(ontem())).toBe(2);
  });

  it('o VALOR do token nunca é persistido — só o id', async () => {
    // Guardar o valor transformaria a telemetria numa segunda cópia do cofre de credenciais,
    // com retenção mais longa e acesso mais amplo.
    await a().record(ev({ tokenId: 'dtk_visivel' }));
    const { rows } = await getPool().query<Record<string, unknown>>('SELECT * FROM install_events LIMIT 1');
    const serializado = JSON.stringify(rows[0]);
    expect(serializado).toContain('dtk_visivel');
    expect(serializado).not.toMatch(/theoskill_dist_/);
  });

  it('a janela é respeitada — evento fora dela não conta', async () => {
    const s = a();
    await s.record(ev());
    // Uma janela que começa no futuro não pode capturar nada.
    const amanha = new Date(Date.now() + 86_400_000);
    expect(await s.adoption('bdl_1', amanha)).toEqual([]);
    expect(await s.countSince(amanha)).toBe(0);
  });

  it('bundle sem instalação devolve lista vazia, não erro', async () => {
    expect(await a().adoption('bdl_inexistente', ontem())).toEqual([]);
  });

  it('bundles do MESMO publisher são contados separadamente', async () => {
    const s = a();
    await s.record(ev({ bundleId: 'bdl_1' }));
    await s.record(ev({ bundleId: 'bdl_2' }));
    expect((await s.adoption('bdl_1', ontem())).reduce((n, r) => n + r.installs, 0)).toBe(1);
    expect((await s.adoption('bdl_2', ontem())).reduce((n, r) => n + r.installs, 0)).toBe(1);
  });
});
