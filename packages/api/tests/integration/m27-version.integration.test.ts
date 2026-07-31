import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createChannelsStore } from '../../src/server/store/channels-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M27 — a coluna `version` passa a ser ESCRITA.
 *
 * Ela existia no schema, o módulo de semver inteiro existia e era testado, e **nada jamais
 * gravava um valor**. Consequência: `isNotNull(version)` no store de canais descartava todo
 * mundo, e o M19 estava marcado `[x]` sobre uma feature que não podia funcionar — o canal
 * nunca encontrava uma revisão para apontar.
 */
describeIntegration('M27 — a versão é escrita e o canal a enxerga', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  const store = () => createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);

  const publicar = async (skillId: string, version?: string) => {
    await store().createWithRevision({
      skillId,
      name: skillId,
      description: 'Faz X. Use quando Y.',
      payload: Buffer.from('z'),
      contentHash: `h-${skillId}-${version ?? 'sem'}`,
      frontmatter: { name: skillId, description: 'd' },
      skillMd: `# ${skillId}`,
      ...(version !== undefined ? { version } : {}),
    });
  };

  it('grava a versão declarada', async () => {
    await publicar('versionada', '1.2.3');
    const { rows } = await getPool().query<{ version: string | null }>(
      'SELECT version FROM skill_revisions WHERE workspace_id=$1 AND skill_id=$2',
      [DEFAULT_WORKSPACE_ID, 'versionada'],
    );
    expect(rows[0]?.version).toBe('1.2.3');
  });

  it('sem versão, a coluna fica NULA — skill não versionada continua válida', async () => {
    await publicar('sem-versao');
    const { rows } = await getPool().query<{ version: string | null }>(
      'SELECT version FROM skill_revisions WHERE workspace_id=$1 AND skill_id=$2',
      [DEFAULT_WORKSPACE_ID, 'sem-versao'],
    );
    expect(rows[0]?.version).toBeNull();
  });

  it('o store de CANAIS enxerga a versão — era isto que `isNotNull` descartava', async () => {
    // O teste que prova o M19 de verdade: sem a escrita, `versionsOf` devolvia sempre vazio
    // e nenhum canal conseguia apontar para revisão alguma.
    await publicar('com-canal', '1.0.0');
    const versoes = await createChannelsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID).versionsOf('com-canal');
    expect(versoes.map((v) => v.version)).toEqual(['1.0.0']);
  });

  it('a versão é POR INQUILINO — o mesmo id versionado em dois clientes não colide', async () => {
    await publicar('compartilhada', '1.0.0');
    await createSkillsStore(createDb(getPool()), 'ws_alheio').createWithRevision({
      skillId: 'compartilhada', name: 'compartilhada', description: 'd',
      payload: Buffer.from('z'), contentHash: 'h-outro',
      frontmatter: { name: 'compartilhada', description: 'd' }, skillMd: '#',
      version: '9.9.9',
    });
    const minhas = await createChannelsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID).versionsOf('compartilhada');
    expect(minhas.map((v) => v.version)).toEqual(['1.0.0']);
  });
});
