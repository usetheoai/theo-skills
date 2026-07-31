import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M24 — a SEGUNDA FASE da descoberta: carregar o corpo da skill escolhida.
 *
 * O agente hospedado no Theo descobre (lista compacta: nome, descrição, categoria, modo) e
 * então CARREGA as instruções só da que escolheu. Nada vai para o disco. Sem esta rota o
 * corpo só sai dentro do zip da revisão — ou seja, "descobrir sem baixar" não existe, e o
 * provider preenche `instructions` com um texto dizendo que o corpo está indisponível.
 */

const MEU = 'ws_meu';
const ALHEIO = 'ws_alheio';

const principalDe = (ws: string): Principal => ({
  workspaceId: ws,
  userId: 'u',
  role: 'member',
  scopes: ['skills:read'],
});

describeIntegration('M24 — carga remota das instruções', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const appDe = (ws: string) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: () => principalDe(ws),
    });

  const semear = async (ws: string, skillId: string, corpo: string, execution = 'remote') => {
    await createSkillsStore(createDb(getPool()), ws).createWithRevision({
      skillId,
      name: skillId,
      description: 'Faz X. Use quando Y.',
      payload: Buffer.from('zip'),
      contentHash: `h-${ws}-${skillId}`,
      frontmatter: { name: skillId, description: 'Faz X. Use quando Y.' },
      skillMd: corpo,
      execution,
    });
  };

  it('devolve o CORPO da revisão corrente — o que o agente injeta no prompt', async () => {
    const corpo = '---\nname: guia\ndescription: d\n---\n\n# Passos\n\n1. Faça isto.\n';
    await semear(MEU, 'guia', corpo);

    const res = await appDe(MEU).request('/v1/skills/guia/instructions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skill_id: string; instructions: string; execution: string };
    expect(body.skill_id).toBe('guia');
    expect(body.instructions, 'o corpo tem que vir INTEIRO — resumo já vem na busca').toBe(corpo);
    expect(body.execution).toBe('remote');
  });

  it('skill `local` é RECUSADA — o corpo dela sozinho não serve', async () => {
    // As instruções de uma skill com script referenciam arquivos que o agente remoto não
    // tem. Devolvê-las produz um agente seguindo passos que não existem — falha plausível,
    // e por isso a pior. A recusa é tipada e aponta o caminho certo (instalar).
    await semear(MEU, 'com-script', '# roda o script\n', 'local');
    const res = await appDe(MEU).request('/v1/skills/com-script/instructions');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe('execution_is_local');
    expect(body.details ?? '', 'a mensagem tem que dizer o que fazer em vez disso').toMatch(/install/i);
  });

  it('skill de OUTRO inquilino é 404 — nunca 403', async () => {
    // 403 confirmaria que a skill existe, e o nome dela é adivinhável. Mesmo contrato de
    // toda leitura por id desde o M11.
    await semear(ALHEIO, 'segredo', '# corpo alheio\n');
    expect((await appDe(MEU).request('/v1/skills/segredo/instructions')).status).toBe(404);
  });

  it('skill inexistente é 404 — indistinguível da alheia, de propósito', async () => {
    expect((await appDe(MEU).request('/v1/skills/nunca-existiu/instructions')).status).toBe(404);
  });

  it('skill PÚBLICA de outro inquilino é carregável, e declara a origem', async () => {
    // O catálogo público existe para ser consumido; o que o consumidor precisa saber é que
    // aquilo é código de terceiro. Sem a marca, ele não distingue do que o próprio time
    // publicou — e essa é a decisão que ele tem de tomar antes de injetar no prompt.
    await semear(ALHEIO, 'publica', '# corpo publico\n');
    await getPool().query("UPDATE skills SET visibility='public' WHERE workspace_id=$1", [ALHEIO]);

    const res = await appDe(MEU).request('/v1/skills/publica/instructions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { origin: string; instructions: string };
    expect(body.origin).toBe('public');
    expect(body.instructions).toBe('# corpo publico\n');
  });

  it('skill apagada é 404 — o corpo não sobrevive ao delete', async () => {
    await semear(MEU, 'apagada', '# corpo\n');
    await getPool().query('UPDATE skills SET deleted_at = now() WHERE workspace_id=$1 AND skill_id=$2', [MEU, 'apagada']);
    expect((await appDe(MEU).request('/v1/skills/apagada/instructions')).status).toBe(404);
  });
});
