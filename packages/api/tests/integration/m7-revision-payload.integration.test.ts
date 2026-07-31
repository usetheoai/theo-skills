import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { createRevisionsStore } from '../../src/server/store/revisions-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M7 — o download da revisão.
 *
 * O DEFEITO QUE ISTO FECHA, medido contra o registry implantado: `theoskill install`
 * esperava um campo `payload_base64` em `GET /v1/skills/:id/revisions/:revisionId`, e a API
 * **nunca** devolveu esse campo — a rota responde `revision_id`, `skill_id`, `content_hash`
 * e `create_time`. A CLI quebrava com `Buffer.from(undefined)`.
 *
 * Passou despercebido porque o teste de contrato da CLI usava um stub que INVENTAVA
 * `payload_base64`. O stub concordava com a expectativa da CLI e ninguém confrontou os dois
 * lados com o servidor real. É a lição de sempre, na forma mais cara: teste verde sobre um
 * duplo que ninguém verificou não prova integração, prova que o duplo combina com o cliente.
 *
 * Os bytes SEMPRE estiveram no banco (`skill_revisions.payload`, gravado pelo publish). O
 * que faltava era a rota de leitura.
 */
describeIntegration('M7 — payload da revisão', () => {
  let bossRef: Awaited<ReturnType<typeof startBoss>> | undefined;
  beforeAll(async () => { bossRef = await startBoss(); });
  beforeEach(truncateAll);
  afterAll(async () => { await bossRef?.stop(); await closePool(); });

  const semear = async (payload: Buffer, contentHash: string) => {
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision({
      skillId: 'payload-demo',
      name: 'payload-demo',
      description: 'demo',
      payload,
      contentHash,
      frontmatter: { name: 'payload-demo', description: 'demo' },
      skillMd: '# payload-demo\n\ndemo',
    });
    const revisions = createRevisionsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const [rev] = await revisions.listBySkill('payload-demo');
    return rev!.revision_id;
  };

  it('devolve os MESMOS bytes que o publish gravou', async () => {
    const bytes = Buffer.from('PK conteudo-de-zip-ficticio');
    const revisionId = await semear(bytes, 'hash-payload-demo');

    const revisions = createRevisionsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    const obtido = await revisions.getPayload(revisionId);

    expect(obtido, 'o payload existe no banco desde o publish').toBeDefined();
    expect(Buffer.compare(obtido!, bytes), 'bytes divergentes tornariam o content_hash inútil').toBe(0);
  });

  it('revisão inexistente devolve `undefined` — nunca bytes de outra', async () => {
    const revisions = createRevisionsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    expect(await revisions.getPayload('rev_naoexiste')).toBeUndefined();
  });

  it('ISOLAMENTO: o payload não atravessa workspace', async () => {
    // Mesma regra de toda leitura por id no M11: um inquilino não alcança o artefato de
    // outro NEM CONHECENDO O ID. Aqui é mais grave que em metadado — o payload é o corpo
    // executável que o agente vai carregar.
    const bytes = Buffer.from('segredo-do-inquilino-A');
    const revisionId = await semear(bytes, 'hash-iso');

    const outro = createRevisionsStore(createDb(getPool()), 'ws_outro_inquilino');
    expect(await outro.getPayload(revisionId)).toBeUndefined();
  });
  it('HTTP: serve os bytes como application/zip com o content_hash no cabeçalho', async () => {
    // A rota nasceu HOJE para corrigir o `payload_base64` inexistente, e até aqui só o STORE
    // tinha teste. O defeito original foi precisamente uma camada testada sobre outra que
    // ninguém exercitou — repetir a omissão na correção seria a mesma falha, um nível acima.
    const bytes = Buffer.from('PK zip-de-verdade');
    const revisionId = await semear(bytes, 'hash-http');
    const app = createApp({ pool: getPool(), queue: bossRef!, logger: createNoopLogger(), reservationHours: 1 });

    const res = await app.request(`/v1/skills/payload-demo/revisions/${revisionId}/payload`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('x-content-hash'), 'sem o hash quem baixa não confere sem 2ª chamada').toBe('hash-http');
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), bytes)).toBe(0);
  });

  it('HTTP: revisão VÁLIDA sob o skill ERRADO devolve 404 — o id da revisão não é credencial', async () => {
    // Sem esta amarração, `/v1/skills/QUALQUER/revisions/{rev}/payload` serviria os bytes de
    // `rev`, e conhecer o id da revisão bastaria para baixar o corpo executável.
    const revisionId = await semear(Buffer.from('bytes'), 'hash-guard');
    const skills = createSkillsStore(createDb(getPool()), DEFAULT_WORKSPACE_ID);
    await skills.createWithRevision({
      skillId: 'outra-demo', name: 'outra-demo', description: 'd',
      payload: Buffer.from('outra'), contentHash: 'hash-outra',
      frontmatter: { name: 'outra-demo', description: 'd' }, skillMd: '# outra',
    });
    const app = createApp({ pool: getPool(), queue: bossRef!, logger: createNoopLogger(), reservationHours: 1 });

    expect((await app.request(`/v1/skills/outra-demo/revisions/${revisionId}/payload`)).status).toBe(404);
    expect((await app.request('/v1/skills/payload-demo/revisions/rev_nope/payload')).status).toBe(404);
  });
});
