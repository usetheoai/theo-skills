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
 * Frontmatter COM versão — o helper compartilhado não a declara, e é justamente o trânsito
 * dela que este teste precisa provar. Aspas obrigatórias: `version: 1.3` sem aspas é um FLOAT
 * em YAML e chegaria como `"1.3"`.
 */
const comVersao = (name: string, description: string, version: string): string =>
  `---\nname: ${name}\ndescription: ${description}\nversion: "${version}"\n---\n# ${name}\n`;

/**
 * REGRESSÃO — a versão declarada precisa atravessar o caminho de ATUALIZAÇÃO, não só o de criação.
 *
 * ACHADO VALIDANDO O SERVIÇO NO AR (2026-08-01), não pela suíte. Publiquei uma skill com
 * `version: "1.2.0"`, atualizei-a com `version: "1.3.0"`, e `GET /v1/skills/:id/versions`
 * seguiu listando **só a 1.2.0**. No banco, a revisão nova tinha `version = NULL`.
 *
 * A causa era uma assimetria entre dois caminhos que deveriam ser o mesmo: o job de CRIAÇÃO
 * carregava `version` e o worker a repassava; o job de ATUALIZAÇÃO **não tinha o campo**, o
 * handler nunca o preenchia, e a chamada a `addRevision` o omitia — embora o store sempre
 * soubesse gravá-lo. A validação aceita a versão, o autor recebe `202`, a operação chega a
 * `ACTIVE`, e a versão some em silêncio.
 *
 * POR QUE ISSO ESVAZIAVA O MARCO INTEIRO. `versionsOf` só devolve revisões com versão. Sem a
 * correção, uma skill tinha versão apenas na PRIMEIRA publicação: da segunda em diante
 * `versions` congelava, e um canal nunca podia apontar para nada além da revisão inicial. O
 * versionamento existia para a primeira publicação e para nenhuma outra, sem erro algum.
 *
 * FORMA DO TESTE. O harness de integração não roda um worker de fundo, então os dois elos são
 * exercitados separadamente, cada um com o código REAL: um espião na fila prova o que a rota
 * enfileira (padrão de `m13-job-carries-tenant`) e o handler do worker é chamado direto
 * (padrão de `operation-lifecycle`). Inventar um worker aqui produziria um dublê que concorda
 * com a expectativa de quem o escreveu — que é exatamente como este defeito sobreviveu.
 */
describeIntegration('M27 — a atualização carrega a versão declarada', () => {
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
    workspaceId: 'default',
    userId: 'u_autor',
    role: 'member',
    scopes: ['skills:read', 'skills:write'],
  };

  it('a SEGUNDA publicação também grava a versão — enfileirada E gravada', async () => {
    const jobs: { nome: string; dados: Record<string, unknown> }[] = [];
    const espiao = {
      ...boss,
      send: (nome: string, dados: unknown, opts: unknown) => {
        jobs.push({ nome, dados: dados as Record<string, unknown> });
        return boss.send(nome, dados as object, opts as object);
      },
    };
    const a = createApp({
      pool: getPool(),
      queue: espiao as never,
      logger: createNoopLogger(),
      reservationHours: 1,
      authVerifier: { resolvePrincipal: () => Promise.resolve(principal) },
    });

    const db = createDb(getPool());
    const skills = createSkillsStore(db, 'default');
    const ops = createOperationsStore(db, 'default');

    // Estado de partida: a skill já existe com a versão da primeira publicação.
    await skills.createWithRevision({
      skillId: 'versionada',
      name: 'versionada',
      description: 'primeira publicacao',
      payload: Buffer.from('z'),
      contentHash: 'h1',
      frontmatter: {},
      skillMd: '#',
      version: '1.2.0',
    });

    // ELO 1 — a rota de atualização precisa ENFILEIRAR a versão declarada.
    const res = await a.request('/v1/skills/versionada?updateMask=zippedFilesystem', {
      method: 'PATCH',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: JSON.stringify({
        zippedFilesystem: await buildZipBase64([
          { path: 'SKILL.md', content: comVersao('versionada', 'segunda publicacao da skill', '1.3.0') },
        ]),
      }),
    });
    expect(res.status).toBe(202);

    const job = jobs.at(-1);
    expect(job, 'a atualização enfileirou um job').toBeDefined();
    expect(job?.dados['version'], 'o job carrega a versão declarada').toBe('1.3.0');

    // ELO 2 — o worker precisa REPASSAR a versão ao store.
    const handle = createUpdateSkillHandler({
      skillsStoreFor: () => skills,
      operationsStoreFor: () => ops,
      logger: createNoopLogger(),
    });
    await handle(job?.dados as never, 0);

    const { rows } = await getPool().query<{ version: string | null }>(
      `SELECT version FROM skill_revisions WHERE skill_id = 'versionada'`,
    );
    expect(rows.length, 'as duas revisões existem').toBe(2);
    expect(rows.map((r) => r.version).sort()).toEqual(['1.2.0', '1.3.0']);
  });
});
