import { DEFAULT_WORKSPACE_ID } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createRevisionsStore } from '../../src/server/store/revisions-store.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

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
  beforeEach(truncateAll);
  afterAll(closePool);

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
});
