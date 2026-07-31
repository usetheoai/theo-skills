import { createId } from '@paralleldrive/cuid2';
import { afterAll, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createOperationsStore } from '../../src/server/store/operations-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * A OPERAÇÃO CARREGA O INQUILINO — na ESCRITA, não só na leitura.
 *
 * `createOperationsStore(db, workspaceId)` recebia o cliente e o usava em toda consulta,
 * mas NUNCA o escrevia no INSERT. A coluna tem `default 'default'`, então toda operação de
 * qualquer cliente era gravada em `default`.
 *
 * O sintoma é o pior tipo: `POST /v1/skills` devolvia `202` com um `operation_id` que o
 * próprio autor **jamais conseguia consultar** — a leitura, essa sim escopada, respondia
 * `404` para a operação que ele acabara de criar. E o inquilino `default` passava a
 * enxergar as operações de todos os outros.
 *
 * Medido contra o serviço no ar em 2026-07-31: publicar como `ws_m24` gravou a operação em
 * `default`. Nenhum teste pegou porque todos usavam o workspace `default`, onde o valor
 * errado e o certo coincidem.
 */

const WS = `ws_op_${createId().slice(0, 8)}`;

describeIntegration('operação carrega o inquilino', () => {
  afterAll(async () => {
    await truncateAll();
    await closePool();
  });

  it('grava workspace_id do store, não o default da coluna', async () => {
    const opId = `op_${createId()}`;
    await createOperationsStore(createDb(getPool()), WS).create({
      operationId: opId,
      skillId: 'skill-do-cliente',
      type: 'CREATE',
      initialState: 'CREATING',
    });

    const { rows } = await getPool().query<{ workspace_id: string }>(
      'select workspace_id from operations where operation_id = $1',
      [opId],
    );
    expect(rows[0]?.workspace_id).toBe(WS);
  });

  it('o autor consegue LER a operação que criou', async () => {
    const opId = `op_${createId()}`;
    const store = createOperationsStore(createDb(getPool()), WS);
    await store.create({ operationId: opId, skillId: 's', type: 'CREATE', initialState: 'CREATING' });
    // Sem o inquilino na escrita este get devolvia undefined — o 404 que o publisher via.
    expect(await store.get(opId)).toBeDefined();
  });

  it('outro inquilino NÃO lê a operação', async () => {
    const opId = `op_${createId()}`;
    await createOperationsStore(createDb(getPool()), WS).create({
      operationId: opId, skillId: 's', type: 'CREATE', initialState: 'CREATING',
    });
    expect(await createOperationsStore(createDb(getPool()), 'default').get(opId)).toBeUndefined();
  });
});
