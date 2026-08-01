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
 * Quem CONSOME a busca precisa saber que ela veio degradada.
 *
 * O log de degradação (corrigido antes) serve **quem opera** o serviço. Não serve **quem o
 * integra**: o cliente recebia `200` com `{trace_id, results}` e nada mais, sem meio de
 * distinguir "achei isto" de "achei isto com meia busca".
 *
 * Por que isso importa neste produto: um agente usa a descoberta **semântica** para escolher
 * qual skill carregar. Com a metade vetorial fora, o ranking é lexical — resultados piores do
 * que o produto promete — e o agente escolhe sem saber que escolheu mal. Não pode decidir se
 * aceita, se tenta de novo depois, nem se avisa o usuário dele.
 *
 * DESENHO: campo no corpo, não header `Warning`. O consumidor é um agente/SDK que lê JSON —
 * header passa despercebido em quase todo cliente de alto nível. O campo é ADITIVO (o corpo
 * já traz `trace_id` além de `results`), então não quebra integração existente. E `Warning`
 * foi REMOVIDO do HTTP na RFC 9111: construir sobre ele é construir sobre algo obsoleto.
 */
const WS = 'ws_deg';

describeIntegration('a degradação da busca é visível para quem CONSOME', () => {
  let boss: Awaited<ReturnType<typeof startBoss>>;

  beforeEach(async () => {
    boss ??= await startBoss();
    await truncateAll();
    await createSkillsStore(createDb(getPool()), WS).createWithRevision({
      skillId: 'sk', name: 'sk', description: 'triagem de chamado',
      payload: Buffer.from('z'), contentHash: 'h', frontmatter: {}, skillMd: '#', version: '1.0.0',
    });
  });
  afterAll(async () => {
    await boss.stop();
    await closePool();
  });

  const app = (embedder?: unknown) =>
    createApp({
      pool: getPool(),
      queue: boss,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: (): Principal => ({ workspaceId: WS, userId: 'u', role: 'member', scopes: ['skills:read'] }),
      ...(embedder !== undefined ? { embedder } : {}),
    } as never);

  /** Embedder indisponível — o estado REAL em produção hoje, não uma simulação. */
  const embedderFora = {
    provider: 'openai',
    model: 'text-embedding-3-small',
    embed: () => Promise.reject(new Error('sem credito')),
    embedBatch: () => Promise.reject(new Error('sem credito')),
  };

  it('metade da busca fora: o corpo DIZ que degradou, e qual metade', async () => {
    const res = await app(embedderFora).request('/v1/skills:retrieve?query=triagem&limit=5');
    expect(res.status, 'ainda responde — a metade viva serve').toBe(200);

    const b = (await res.json()) as { results: unknown[]; degraded?: { legs: string[] } };
    expect(b.results.length, 'a perna lexical respondeu').toBeGreaterThan(0);
    expect(b.degraded, 'o cliente consegue distinguir busca inteira de meia busca').toBeDefined();
    expect(b.degraded?.legs, 'e sabe QUAL metade caiu — sem isso não dá para decidir se aceita').toEqual(['vector']);
  });

  it('busca sã: o campo NÃO aparece — ausência significa íntegra', async () => {
    // Se o campo viesse sempre, o consumidor teria de inspecioná-lo a cada resposta para
    // descobrir que está tudo bem. Ausente-significa-íntegro mantém o caso normal silencioso
    // e o anormal explícito.
    const res = await app().request('/v1/skills:retrieve?query=triagem&limit=5&strategy=keyword');
    expect(res.status).toBe(200);
    expect((await res.json() as { degraded?: unknown }).degraded).toBeUndefined();
  });
});
