import { formatVersion, parseVersion, resolveRange } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createChannelsStore } from '../../src/server/store/channels-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M19 — canais e versionamento para o consumidor.
 *
 * O que estes testes protegem é a promessa que o consumidor compra ao escrever `@stable` em
 * vez de um id de revisão: que o ponteiro seja mutável, auditável e REVERSÍVEL, e que a
 * revisão para a qual ele aponta não desapareça debaixo dele.
 */

const WS = 'ws_chan';
const SK = 'sk_1';

describeIntegration('M19 — canais e resolução de versão', () => {
  const store = () => createChannelsStore(createDb(getPool()), WS);

  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, latest_revision_id, search_text)
       VALUES ($1,$2,'s','d','rev_3','s d')`,
      [WS, SK],
    );
    for (const [rev, ver] of [
      ['rev_1', '1.0.0'],
      ['rev_2', '1.1.0'],
      ['rev_3', '2.0.0'],
      ['rev_4', '2.1.0-beta.1'],
    ]) {
      await pool.query(
        `INSERT INTO skill_revisions (revision_id, workspace_id, skill_id, payload, content_hash, frontmatter, skill_md, version)
         VALUES ($1,$2,$3,'\\x00',$4,'{}'::jsonb,'corpo',$5)`,
        [rev, WS, SK, `h_${rev}`, ver],
      );
    }
  });

  afterAll(closePool);

  it('promover grava o alvo ANTERIOR na mesma escrita', async () => {
    const s = store();
    await s.promote(SK, 'stable', 'rev_1', 'u_1');
    await s.promote(SK, 'stable', 'rev_2', 'u_1');
    const c = await s.get(SK, 'stable');
    expect(c).toMatchObject({ revisionId: 'rev_2', previousRevisionId: 'rev_1' });
  });

  it('REVERSÍVEL: rollback volta ao anterior, e permite avançar de novo', async () => {
    // Reverter é operação de incidente. Se fosse via de mão única, o operador ficaria preso
    // na versão antiga depois de reverter.
    const s = store();
    await s.promote(SK, 'stable', 'rev_1', null);
    await s.promote(SK, 'stable', 'rev_2', null);

    expect(await s.rollback(SK, 'stable')).toBe(true);
    expect((await s.get(SK, 'stable'))?.revisionId).toBe('rev_1');

    expect(await s.rollback(SK, 'stable')).toBe(true);
    expect((await s.get(SK, 'stable'))?.revisionId).toBe('rev_2');
  });

  it('rollback sem histórico devolve false em vez de apagar o canal', async () => {
    const s = store();
    await s.promote(SK, 'stable', 'rev_1', null);
    expect(await s.rollback(SK, 'stable')).toBe(false);
    expect((await s.get(SK, 'stable'))?.revisionId).toBe('rev_1');
  });

  it('canais são INDEPENDENTES — mover beta não mexe em stable', async () => {
    const s = store();
    await s.promote(SK, 'stable', 'rev_3', null);
    await s.promote(SK, 'beta', 'rev_4', null);
    expect((await s.get(SK, 'stable'))?.revisionId).toBe('rev_3');
    expect((await s.get(SK, 'beta'))?.revisionId).toBe('rev_4');
    expect((await s.list(SK)).map((c) => c.channel).sort()).toEqual(['beta', 'stable']);
  });

  it('REVISÃO FIXADA por canal é detectável antes de apagar', async () => {
    // M19 DoD #5. Apagar uma revisão sob um canal deixaria o ponteiro apontando para o vazio,
    // e todo consumidor de `@stable` quebraria de uma vez.
    const s = store();
    await s.promote(SK, 'stable', 'rev_2', null);
    expect(await s.channelsPinning(SK, 'rev_2')).toEqual(['stable']);
    expect(await s.channelsPinning(SK, 'rev_1')).toEqual([]);
  });

  it('RESOLUÇÃO NO SERVIDOR: intervalo resolve contra as versões publicadas', async () => {
    // O cliente declara intenção; o servidor escolhe. Resolver no cliente exigiria baixar a
    // lista inteira a cada instalação e deixaria dois clientes em desacordo sobre `^1.0.0`.
    const versoes = (await store().versionsOf(SK)).map((r) => parseVersion(r.version));
    expect(formatVersion(resolveRange('^1.0.0', versoes)!)).toBe('1.1.0');
    expect(formatVersion(resolveRange('latest', versoes)!)).toBe('2.0.0'); // beta não entra
    expect(formatVersion(resolveRange('2.1.0-beta.1', versoes)!)).toBe('2.1.0-beta.1');
  });

  it('o store é escopado por workspace', async () => {
    const a = createChannelsStore(createDb(getPool()), WS);
    const b = createChannelsStore(createDb(getPool()), 'ws_outro');
    await a.promote(SK, 'stable', 'rev_1', null);
    expect(await b.get(SK, 'stable')).toBeNull();
    expect(await b.list(SK)).toEqual([]);
  });
});
