import { expect, it } from 'vitest';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * Guarda contra um erro que já custou dois diagnósticos nesta base: criar uma tabela e
 * esquecê-la no `truncateAll`.
 *
 * O sintoma é traiçoeiro — a falha aparece no teste SEGUINTE, por estado que sobrou do
 * anterior, e não no que criou a tabela. Aconteceu com `users`/`workspace_users` (M13) e
 * de novo com `skill_channels` (M19). Um comentário pedindo atenção não resolveu; este teste
 * resolve, porque falha no instante em que a tabela nova aparece sem estar na lista.
 */
describeIntegration('infra de teste — truncateAll cobre TODA tabela do produto', () => {
  it('nenhuma tabela do schema fica de fora da limpeza', async () => {
    const pool = getPool();
    // Semeia nada; apenas confirma que truncar não deixa linha em tabela alguma do produto.
    await truncateAll();
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '__drizzle%'`,
    );
    const naoLimpas: string[] = [];
    for (const { table_name } of rows) {
      const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table_name}"`);
      if (r.rows[0]?.n !== '0') naoLimpas.push(`${table_name}=${r.rows[0]?.n ?? '?'}`);
    }
    expect(
      naoLimpas,
      `tabelas com linhas após truncateAll — provavelmente ausentes da lista em _helpers/db.ts:\n${naoLimpas.join('\n')}`,
    ).toEqual([]);
    await closePool();
  });
});
