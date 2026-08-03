import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';

import { createPool, idlePoolErrorCount } from '../../src/server/db.js';
import { createQueue, JOB_NAMES } from '../../src/server/queue/queue.js';

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

  it('SEGUNDO POOL: o do pg-boss também sobrevive, e a pré-condição é afirmada (LT-039)', async () => {
    // A recusa do LT-039 foi por escopo: há DOIS pools no processo. O primeiro teste exercita
    // só o da API — e um cenário que derruba o Postgres com apenas um pool ocioso passa com o
    // outro desprotegido. Foi exatamente o que aconteceu.
    //
    // A ARMADILHA que este teste evita: com `idleCount === 0` sobreviver a um restart não prova
    // nada, porque o cenário que mata é o erro no cliente OCIOSO. Sem afirmar a pré-condição, o
    // teste fica verde mesmo que alguém remova o ouvinte depois — ou seja, cego à mutação que
    // ele existe para pegar. Por isso as asserções de preparo são explícitas e vêm ANTES.
    const registrados: string[] = [];
    const boss = createQueue(PG_URI, {
      info: () => undefined,
      error: (_f, msg) => registrados.push(msg),
    });
    await boss.start();
    const pidAntes = process.pid;

    const pool = createPool(PG_URI, { info: () => undefined, error: () => undefined });
    const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pidApi = rows[0]?.pid;

    // PRÉ-CONDIÇÃO, afirmada e não presumida: o pool da API tem cliente ocioso.
    expect(pool.idleCount, 'pool da API sem cliente ocioso — o cenário que mata não foi montado').toBeGreaterThan(0);
    // E o pg-boss tem conexões próprias abertas (ele mantém as suas após `start()`).
    const { rows: conns } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE application_name = '@usetheo/skills-api'",
    );
    expect(
      Number(conns[0]?.n ?? '0'),
      'pg-boss sem conexão própria — sem ela, derrubar o banco não exercita o segundo pool',
    ).toBeGreaterThan(0);

    const antes = idlePoolErrorCount();

    // Derruba TODOS os backends do processo (API + pg-boss), que é o que um restart faz.
    carrasco = new Pool({ connectionString: PG_URI, max: 1 });
    carrasco.on('error', () => undefined);
    await carrasco.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND (pid = $1 OR application_name = '@usetheo/skills-api')",
      [pidApi],
    );
    await new Promise((r) => setTimeout(r, 800));

    // O processo é o MESMO — sob supervisor, um processo que morreu e voltou também responde.
    expect(process.pid, 'o PID mudou: o processo morreu e foi reiniciado, não sobreviveu').toBe(pidAntes);
    expect(idlePoolErrorCount(), 'nenhum erro contado — os ouvintes não viram nada').toBeGreaterThan(antes);

    // A ASSERÇÃO QUE DISCRIMINA, e que eu tinha omitido: o contador é do PROCESSO, então o
    // ouvinte da API sozinho já o incrementa — com ele, remover o ouvinte do pg-boss deixava
    // este teste VERDE. Medido: as duas mutações (sem ouvinte, ouvinte vazio) passavam.
    // O que prova que o SEGUNDO pool foi protegido é o registro vindo DELE.
    expect(
      registrados,
      'o ouvinte do pg-boss não registrou nada — o segundo pool está desprotegido, ' +
        'e o contador do processo esconde isso porque o pool da API já o incrementou',
    ).not.toEqual([]);

    // E os dois lados voltam a funcionar.
    const depois = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(depois.rows[0]?.ok).toBe(1);
    await expect(boss.getQueueSize(JOB_NAMES.CREATE_SKILL)).resolves.toBeTypeOf('number');

    await boss.stop({ graceful: false });
    await pool.end();
  }, 90_000);
});
