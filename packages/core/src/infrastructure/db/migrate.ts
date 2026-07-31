import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

/**
 * Advisory lock que serializa a migração entre réplicas.
 *
 * Constante arbitrária porém FIXA: o valor não significa nada, mas precisa ser o mesmo em
 * todo processo que migra este banco — é o que faz duas réplicas competirem pelo mesmo lock
 * em vez de cada uma pegar o seu e as duas passarem.
 */
const MIGRATION_LOCK_ID = 4_872_119;

/**
 * Pasta das migrations resolvida RELATIVA a este módulo.
 *
 * O caminho é idêntico em `src/` e em `dist/` porque o build copia os `.sql` para o espelho
 * compilado. Isso vale mais do que parece: uma variável de ambiente com o caminho seria um
 * segundo lugar para errar, e um caminho relativo ao CWD quebraria conforme de onde o
 * processo foi iniciado — que é justamente o que difere entre rodar local e rodar na imagem.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * Aplica o schema. A imagem passa a ser autossuficiente: não existe passo manual entre puxar
 * a imagem e ter um serviço que serve.
 *
 * POR QUE NO BOOT, e não num job separado. O `drizzle-kit` é devDependency e não existe na
 * imagem de produção — só o migrator do `drizzle-orm`, que é dependência de produção. Um job
 * separado exigiria uma segunda imagem (ou o retorno das devDependencies, desfazendo a
 * eliminação de 41 CVEs). O `pg-boss` já bootstrapa o próprio schema no boot deste mesmo
 * servidor; migrar aqui é o precedente que o produto já adota.
 *
 * O QUE ISSO CORRIGE. Sem este passo o serviço subia com ZERO tabelas: `/v1/health` devolvia
 * 200 — porque ele é estático de propósito — enquanto `/v1/skills` devolvia 500. Um serviço
 * "saudável" servindo erro em tudo é pior do que um serviço fora do ar, porque o painel o
 * conta como frota completa.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Lock de SESSÃO, não de transação: o migrator abre transações próprias por arquivo, e um
    // lock transacional seria liberado no primeiro COMMIT — deixando as demais migrations
    // desprotegidas exatamente no meio da janela que precisa ser exclusiva.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
