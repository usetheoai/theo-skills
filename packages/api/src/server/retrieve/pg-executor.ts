import { type QueryExecutor } from '@usetheo/skills';
import { type Pool } from 'pg';

/** Wrap a pg Pool as the core `QueryExecutor` port (DIP boundary). */
export function createPgExecutor(pool: Pool): QueryExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[]): Promise<T[]> {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows as T[];
    },
  };
}
