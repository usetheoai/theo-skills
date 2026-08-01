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
  // Esvazia a fila INTEIRA, não só os jobs em estado terminal.
  //
  // Isto é seguro AQUI e não seria em qualquer outro ponto: `truncateAll` roda no
  // `beforeEach`, quando o teste corrente ainda não enfileirou nada. O que sobra na fila
  // nesse instante pertence a testes ANTERIORES cujas tabelas acabaram de ser truncadas —
  // são órfãos por definição, e os workers seguem vivos entre os arquivos, então eles são
  // pescados e processados competindo com o teste que está começando.
  //
  // Medido em 2026-08-01: 7 `created` + 1 `active` sobrevivendo ao fim da suíte. Era a causa
  // de `webhook-delivery` falhar na suíte completa e passar isolado — o orçamento de espera
  // é o mesmo nos dois casos, mas na suíte completa o worker tem um backlog pela frente.
  // Um teste intermitente treina o time a ignorar o vermelho, que é como dois defeitos
  // chegaram ao ar neste repositório.
  //
  // `to_regclass` devolve NULL antes do primeiro `boss.start()`, então isto é seguro em banco
  // recém-criado.
  await getPool().query(`
    DO $$
    BEGIN
      IF to_regclass('pgboss.job') IS NOT NULL THEN
        DELETE FROM pgboss.job;
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
