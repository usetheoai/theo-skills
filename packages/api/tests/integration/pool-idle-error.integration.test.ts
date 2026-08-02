import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';

import { createPool, idlePoolErrorCount } from '../../src/server/db.js';

import { describeIntegration } from './_helpers/env.js';

/**
 * Um cliente OCIOSO do pool que emite erro sem listener vira `uncaughtException` e **derruba o
 * processo**. Não é degradação: é o serviço inteiro caindo porque o banco reiniciou — evento
 * rotineiro de operação.
 *
 * O cenário é provocado de VERDADE, não simulado: um segundo pool encerra o backend do cliente
 * ocioso com `pg_terminate_backend`, que é o mesmo mecanismo pelo qual um restart do Postgres
 * derruba as conexões existentes.
 *
 * Um teste que apenas instanciasse o pool e afirmasse que o listener existe passaria numa
 * implementação com handler VAZIO — e handler vazio troca "processo morre" por "processo vivo
 * com pool quebrado", que é pior porque não aparece em lugar nenhum. Por isso as três
 * asserções abaixo, e nenhuma delas sozinha basta.
 */
const PG_URI = process.env['THEOSKILL_PG_URI'] ?? '';

let carrasco: Pool | undefined;
afterAll(async () => {
  await carrasco?.end();
});

describeIntegration('pool: erro em cliente ocioso não derruba o processo (LT-036)', () => {
  it('sobrevive ao backend ser encerrado E a próxima query funciona E a ocorrência foi contada', async () => {
    const registrados: { fields: Record<string, unknown>; msg: string }[] = [];
    const pool = createPool(PG_URI, {
      info: () => undefined,
      error: (fields, msg) => registrados.push({ fields: { ...fields }, msg }),
    });

    // Uma query para que o pool abra um cliente e o devolva OCIOSO — é esse o cliente cujo
    // erro não tem quem o receba.
    const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pid = rows[0]?.pid;
    expect(pid, 'não obtive o pid do backend — o cenário não foi montado').toBeTypeOf('number');
    expect(pool.idleCount).toBeGreaterThan(0);

    const antes = idlePoolErrorCount();

    // O gatilho REAL: encerra o backend daquele cliente, de fora. É o que um restart do
    // Postgres faz com toda conexão aberta.
    carrasco = new Pool({ connectionString: PG_URI, max: 1 });
    carrasco.on('error', () => undefined); // o carrasco não é o objeto do teste
    await carrasco.query('SELECT pg_terminate_backend($1)', [pid]);

    // Dá tempo ao socket de propagar o fechamento e ao pool de emitir 'error'.
    await new Promise((r) => setTimeout(r, 500));

    // (1) O processo continua vivo. Se o handler não existisse, a exceção não capturada teria
    //     derrubado o worker do vitest e nem chegaríamos aqui — a linha só executa porque
    //     sobrevivemos.
    expect(process.exitCode ?? 0).toBe(0);

    // (2) A ocorrência foi OBSERVADA. É esta asserção que mata o handler vazio: ele mantém o
    //     processo vivo e não registra nada, então a metade (1) passaria e o operador nunca
    //     saberia que o banco reiniciou.
    expect(idlePoolErrorCount(), 'o erro do cliente ocioso não foi contado').toBeGreaterThan(antes);
    expect(registrados.length, 'nada foi registrado — handler mudo é handler que engole').toBeGreaterThan(0);
    expect(registrados.at(-1)?.fields['erro']).toBeTypeOf('string');

    // (3) O pool SE RECUPEROU. Esta é a metade que um handler que engole e deixa o pool
    //     inutilizável não passaria: processo vivo, sim, mas servindo erro a toda requisição.
    const depois = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(depois.rows[0]?.ok).toBe(1);

    await pool.end();
  });
});
