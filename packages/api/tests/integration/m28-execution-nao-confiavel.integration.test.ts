import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createOperationsStore } from '../../src/server/store/operations-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';
import { createUpdateSkillHandler } from '../../src/server/worker.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64 } from './_helpers/zip.js';

/**
 * `execution` não era confiável — e é ele que decide se um payload COM SCRIPTS pode ser
 * servido como instrução remota.
 *
 * A cadeia tinha dois elos partidos, achados pela revisão de M24–M27:
 *
 *   1. A republicação não propagava `execution` (nem `category`). A coluna congelava no valor
 *      da PRIMEIRA publicação — o mesmo defeito de "segunda passada" que já mordeu `version`.
 *   2. O retriever vetorial não projetava a coluna, e a fusão híbrida (estratégia PADRÃO)
 *      preserva a linha do vetor sobre a do keyword. Para toda skill presente nas duas listas
 *      — o caso comum — `execution` sumia do resultado. O cliente trata ausente como
 *      permitido.
 *
 * Juntos: uma skill publicada `remote` e republicada `local` com scripts continuava
 * anunciada como remota, e o gate que existe para recusá-la nunca disparava.
 */

const WS = 'default';
const frontmatter = (exec: string, cat: string, ver: string) =>
  `---\nname: cobranca\ndescription: rotina de cobranca amigavel para inadimplencia recente\ncategory: ${cat}\nexecution: ${exec}\nversion: "${ver}"\n---\n# Cobranca\nPasso a passo.\n`;

describeIntegration('execution e category precisam sobreviver à republicação', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    await getPool().query("INSERT INTO users (user_id,email) VALUES ('u_a','a@p.dev')");
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const principal: Principal = { workspaceId: WS, userId: 'u_a', role: 'admin', scopes: ['skills:admin'] };

  it('a REPUBLICAÇÃO atualiza execution e category — não congela na primeira', async () => {
    const jobs: Record<string, unknown>[] = [];
    const espiao = {
      ...boss,
      send: (n: string, d: unknown, o: unknown) => {
        jobs.push(d as Record<string, unknown>);
        return boss.send(n, d as object, o as object);
      },
    };
    const app = createApp({
      pool: getPool(),
      queue: espiao as never,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principal,
    });

    const db = createDb(getPool());
    const skills = createSkillsStore(db, WS);
    await skills.createWithRevision({
      skillId: 'cobranca',
      name: 'cobranca',
      description: 'rotina de cobranca',
      payload: Buffer.from('z'),
      contentHash: 'h1',
      frontmatter: {},
      skillMd: '#',
      version: '1.0.0',
      category: 'Finance',
      execution: 'remote',
    });

    // Republica declarando OUTRA categoria e OUTRO modo de execução.
    const res = await app.request('/v1/skills/cobranca?updateMask=zippedFilesystem', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        zippedFilesystem: await buildZipBase64([
          { path: 'SKILL.md', content: frontmatter('local', 'Ops', '2.0.0') },
          { path: 'run.sh', content: '#!/bin/sh\necho oi\n' },
        ]),
      }),
    });
    expect(res.status).toBe(202);

    const job = jobs.at(-1)!;
    expect(job['execution'], 'o job carrega o modo de execução declarado').toBe('local');
    expect(job['category'], 'o job carrega a categoria declarada').toBe('Ops');

    await createUpdateSkillHandler({
      skillsStoreFor: () => skills,
      operationsStoreFor: () => createOperationsStore(db, WS),
      logger: createNoopLogger(),
    })(job as never, 0);

    const { rows } = await getPool().query<{ execution: string; category: string | null }>(
      "SELECT execution, category FROM skills WHERE skill_id='cobranca'",
    );
    expect(rows[0]?.execution, 'a coluna acompanha a republicação').toBe('local');
    expect(rows[0]?.category).toBe('Ops');
  });

  it('a skill republicada como local deixa de ser servida como instrução remota', async () => {
    // O efeito que importa para quem consome: `/instructions` existe para skill remota. Uma
    // skill que passou a ter scripts precisa ser recusada — é esse gate que a coluna
    // congelada desarmava.
    const db = createDb(getPool());
    const skills = createSkillsStore(db, WS);
    await skills.createWithRevision({
      skillId: 'cobranca',
      name: 'cobranca',
      description: 'd',
      payload: Buffer.from('z'),
      contentHash: 'h1',
      frontmatter: {},
      skillMd: '#',
      version: '1.0.0',
      execution: 'remote',
    });
    const app = createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principal,
    });
    expect((await app.request('/v1/skills/cobranca/instructions')).status).toBe(200);

    await getPool().query("UPDATE skills SET execution='local' WHERE skill_id='cobranca'");
    const depois = await app.request('/v1/skills/cobranca/instructions');
    expect(depois.status, 'local não é servida como instrução remota').toBe(422);
  });
});
