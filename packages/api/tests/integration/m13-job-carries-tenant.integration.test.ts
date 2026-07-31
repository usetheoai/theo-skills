import { type Principal } from '@usetheo/skills';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { startBoss } from './_helpers/boss.js';
import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';
import { buildZipBase64, skillMd } from './_helpers/zip.js';

/**
 * REGRESSÃO — o inquilino precisa ATRAVESSAR A FILA.
 *
 * O payload enviado em `queue.send` não carregava `workspaceId`, e `worker.ts::jobWorkspace`
 * fazia `data.workspaceId ?? DEFAULT_WORKSPACE_ID`. Toda skill publicada por um cliente era
 * gravada em `default`: o autor recebia 202 e não a encontrava depois, porque o `GET` dele
 * filtra pelo próprio workspace.
 *
 * Passou despercebido porque **todos** os testes de isolamento semeiam por SQL cru, já com o
 * `workspace_id` correto. Eles provam que a LEITURA respeita o escopo — sobre linhas que
 * nunca passaram pelo caminho de escrita. Um campo opcional com `??` restaura exatamente a
 * disciplina que a estrutura deste projeto substituiu: tenant fixado na construção, para que
 * nenhum caminho consiga omiti-lo.
 *
 * ESCOPO DESTE TESTE, honestamente: ele prova que o enqueue PROPAGA o inquilino — o elo que
 * estava quebrado. NÃO prova a gravação ponta a ponta pelo worker; a versão e2e desse teste
 * falha por um motivo no harness que ainda não foi diagnosticado (a operação nasce em
 * `default` nele, com a mesma configuração que aqui produz `ws_autor`), e afirmar cobertura
 * que não existe seria pior que declarar a lacuna.
 */
describeIntegration('M13 — o job carrega o inquilino', () => {
  beforeEach(truncateAll);
  afterAll(closePool);

  it('o payload enfileirado carrega o workspace de quem publicou', async () => {
    const boss = await startBoss();
    const enviados: Record<string, unknown>[] = [];
    const espiao = {
      send: (nome: string, dados: unknown, opts: unknown) => {
        enviados.push(dados as Record<string, unknown>);
        return boss.send(nome, dados as object, opts as object);
      },
    };

    const app = createApp({
      pool: getPool(),
      queue: espiao as never,
      logger: createNoopLogger(),
      reservationHours: 1,
      principalResolver: (): Principal => ({
        workspaceId: 'ws_autor',
        userId: 'u_autor',
        role: 'member',
        scopes: ['skills:admin'],
      }),
    });

    const zip = await buildZipBase64([
      { path: 'SKILL.md', content: skillMd('minha-do-autor', 'Faz X. Use quando Y.') },
    ]);
    const res = await app.request('/v1/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: 'minha-do-autor', zippedFilesystem: zip }),
    });
    expect(res.status).toBe(202);

    const payload = enviados[0];
    expect(payload, 'nada foi enfileirado').toBeDefined();
    expect(
      payload?.['workspaceId'],
      'o job não carrega o inquilino — o worker gravaria em `default`',
    ).toBe('ws_autor');

    await boss.stop();
  });
});
