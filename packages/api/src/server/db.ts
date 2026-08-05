import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { type Logger } from './logger.js';

export type Db = NodePgDatabase<Record<string, never>>;

/**
 * Quantas vezes um cliente OCIOSO do pool emitiu erro. Exportado porque sem isto a ocorrência
 * seguinte volta a ser invisível: o processo sobrevive, o pool se recupera, e ninguém fica
 * sabendo que o banco reiniciou embaixo do serviço.
 */
let errosDeClienteOcioso = 0;
export function idlePoolErrorCount(): number {
  return errosDeClienteOcioso;
}

/**
 * Incrementa o contador a partir de OUTRO pool do processo (o interno do pg-boss).
 *
 * Existe porque o contador precisa ser do PROCESSO, não do pool: dois contadores separados
 * fariam cada metade parecer pequena e a soma sumir — e foi justamente um segundo pool
 * invisível que manteve o defeito vivo depois do primeiro conserto.
 */
export function recordIdlePoolError(): void {
  errosDeClienteOcioso += 1;
}

/**
 * Constrói o pool COM ouvinte de erro — sem ele, o processo inteiro cai.
 *
 * No node-postgres, um erro emitido por um cliente **ocioso** do pool sem listener vira
 * `uncaughtException` e derruba o processo. Não é degradação: é o serviço inteiro caindo por
 * causa de um restart do banco, que é evento rotineiro de operação.
 *
 * O handler NÃO engole. Engolir trocaria "processo morre" por "processo vivo com pool
 * quebrado", que é pior — some do log, some do alarme, e o serviço passa a errar tudo sem que
 * nada acuse. Aqui ele registra com contexto e deixa o pool se recuperar sozinho (o
 * node-postgres descarta o cliente defeituoso e abre outro na próxima aquisição), e conta a
 * ocorrência para que a próxima não seja invisível.
 */
/**
 * `logger` é OBRIGATÓRIO de propósito — era opcional e a produção o omitiu.
 *
 * Com `logger?.error(...)`, esquecer de passá-lo transformava o ouvinte num no-op silencioso:
 * o processo sobrevivia ao restart do banco e ninguém ficava sabendo. Medido em produção
 * (LT-039): após dois restarts reais, ZERO linhas dos handlers no log. Resiliência sem
 * observabilidade é o defeito, não a solução.
 *
 * Exigir o parâmetro faz o compilador impedir a omissão, em vez de um teste torcer para que
 * ela não aconteça — é a diferença entre tornar o erro impossível e tentar detectá-lo.
 */
export function createPool(uri: string, logger: Logger): Pool {
  const pool = new Pool({ connectionString: uri });
  pool.on('error', (err: Error) => {
    errosDeClienteOcioso += 1;
    logger.error(
      {
        erro: err.message,
        codigo: (err as { code?: unknown }).code ?? null,
        ocorrencias: errosDeClienteOcioso,
        total_no_pool: pool.totalCount,
        ociosos: pool.idleCount,
      },
      'idle pool client emitted an error — the pool stays alive and reopens the connection on the next query',
    );
  });
  return pool;
}

/** Wrap a pool in a Drizzle client. */
export function createDb(pool: Pool): Db {
  return drizzle(pool);
}
