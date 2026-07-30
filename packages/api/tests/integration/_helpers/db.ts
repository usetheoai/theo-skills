import { Pool } from 'pg';

import { PG_URI } from './env.js';

let pool: Pool | undefined;

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: PG_URI });
  return pool;
}

/**
 * Reset entre testes: tabelas de domínio E as filas do pg-boss.
 *
 * O DEFEITO QUE A SEGUNDA PARTE CORRIGE (encontrado em M10, ao rodar a suíte num CI limpo):
 * esta função limpava só o domínio — o comentário anterior até declarava que "as tabelas do
 * pg-boss vivem no schema pgboss", como se isso fosse razão para deixá-las. Não é: os JOBS
 * sobrevivem ao truncate do domínio.
 *
 * Consequência observada: um teste enfileira `webhook_delivery`; o teste seguinte trunca
 * `webhook_endpoints` e enfileira o seu; o worker acorda e consome o job ANTIGO, cujo
 * endpoint já não existe. O `waitFor` do teste atual expira esperando uma entrega que o
 * worker gastou noutro job. Isso produzia 3-5 vermelhos entre 8, VARIANDO entre execuções do
 * mesmo commit — a assinatura clássica de estado compartilhado entre testes
 * (`rules/testing.md` § 6: "testes dependendo de ordem ou estado compartilhado").
 *
 * Medido no banco após uma rodada: 200 jobs `completed` acumulados em 5 filas.
 *
 * `pgboss.job` é particionada por fila (uma tabela `j<hash>` por nome); `TRUNCATE` na tabela
 * pai propaga para as partições. `archive` guarda o histórico e também precisa ir — senão o
 * reconciliador enxerga entrega antiga como pendente.
 */
export async function truncateAll(): Promise<void> {
  await getPool().query(
    'TRUNCATE TABLE embeddings, webhook_deliveries, webhook_endpoints, operations, skill_revisions, skills RESTART IDENTITY CASCADE',
  );
  // Remove APENAS jobs em estado terminal. `TRUNCATE pgboss.job` seria mais simples e está
  // ERRADO: os workers são registrados uma vez no `beforeAll` e seguem vivos entre os testes,
  // então truncar a fila apaga o job que o teste CORRENTE acabou de enfileirar — troca uma
  // corrida por outra (medido: as falhas mudavam de identidade a cada execução).
  //
  // `to_regclass` devolve NULL antes do primeiro `boss.start()`, então isto é seguro em banco
  // recém-criado.
  await getPool().query(`
    DO $$
    BEGIN
      IF to_regclass('pgboss.job') IS NOT NULL THEN
        DELETE FROM pgboss.job WHERE state IN ('completed', 'failed', 'cancelled');
      END IF;
      IF to_regclass('pgboss.archive') IS NOT NULL THEN
        DELETE FROM pgboss.archive;
      END IF;
    END $$;
  `);
}

export async function closePool(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
  }
}
