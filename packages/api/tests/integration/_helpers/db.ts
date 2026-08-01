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
    // `api_keys`, `workspace_users` e `users` entram no M13. Esquecer uma tabela nova aqui
    // produz falha por chave duplicada no teste SEGUINTE, não no que a criou — o tipo de
    // erro que se persegue no arquivo errado.
    'TRUNCATE TABLE embeddings, install_events, webhook_deliveries, webhook_endpoints, operations, distribution_tokens, bundle_items, bundles, skill_channels, skill_revisions, skills, api_keys, workspace_users, users RESTART IDENTITY CASCADE',
  );
  // Remove APENAS jobs em estado terminal. `DELETE FROM pgboss.job` (sem filtro) é mais
  // simples e está ERRADO — eu tentei, e medi o estrago.
  //
  // O raciocínio que me convenceu era: "no `beforeEach` o teste corrente ainda não enfileirou
  // nada, logo o que está na fila é órfão". A premissa é verdadeira e a conclusão não: vários
  // arquivos registram os workers no `beforeAll` (ver `trace-propagation`), e esvaziar a
  // tabela debaixo de um worker já registrado o deixa sem pescar nada. Medido em 2026-08-01:
  // `trace_id_flows_create_to_webhook` passou a dar timeout de 46 s com a fila vazia e voltou
  // a passar assim que o filtro foi restaurado — troquei um teste intermitente por um
  // quebrado, que é pior negócio.
  //
  // O backlog órfão que a purga tentava resolver É REAL (7 `created` + 1 `active` sobreviveram
  // ao fim de uma suíte) e continua aberto no board. A solução não é esta.
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
