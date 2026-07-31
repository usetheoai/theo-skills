import { type Context, type MiddlewareHandler, type Next } from 'hono';

import { type AppEnv } from '../principal-context.js';

/** Classe de custo da requisição — leitura e escrita têm orçamentos distintos. */
export type RateClass = 'read' | 'write';

export interface RateLimitConfig {
  /** Requisições por janela, por principal, para cada classe. */
  readonly read: number;
  readonly write: number;
  /** Tamanho da janela em ms. */
  readonly windowMs: number;
}

export interface RateLimitDeps {
  readonly config: RateLimitConfig;
  /** Relógio injetável — testes controlam o tempo em vez de dormir. */
  readonly now?: () => number;
  /** Classifica a requisição. Default: métodos que mudam estado são `write`. */
  readonly classify?: (c: Context<AppEnv>) => RateClass;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const defaultClassify = (c: Context<AppEnv>): RateClass =>
  c.req.method === 'GET' || c.req.method === 'HEAD' ? 'read' : 'write';

/**
 * Rate limiting por PRINCIPAL (M17 DoD #2).
 *
 * Janela fixa em memória — deliberadamente, não por simplismo:
 *
 *  - **Por principal, não por IP.** Num registry multi-tenant o IP é do gateway do cliente,
 *    então limitar por IP puniria todos os usuários de um mesmo cliente pelo excesso de um só,
 *    e não conteria nada quando o abuso vem de IPs distintos com a mesma credencial.
 *  - **Em memória, sem Redis.** O `ROADMAP.md` declara "sem Redis" como restrição de stack.
 *    A consequência é honesta e está declarada: com N réplicas o limite efetivo é N × limite,
 *    porque cada processo conta sozinho. Isso é aceitável para conter abuso acidental (um
 *    laço que dispara requisições), e NÃO é suficiente contra abuso deliberado — para isso o
 *    lugar certo é a borda, antes da aplicação.
 *  - **Orçamentos distintos** porque as operações não custam o mesmo: uma leitura é uma
 *    consulta; uma escrita enfileira trabalho, gera embedding e dispara webhook.
 *
 * Responde `429` com **`Retry-After`** — sem ele o cliente não sabe quando voltar e tende a
 * retentar imediatamente, transformando o limite em amplificador de carga. É o risco #2 do
 * milestone, e o cabeçalho é a mitigação.
 */
export function createRateLimiter(deps: RateLimitDeps): MiddlewareHandler<AppEnv> {
  const now = deps.now ?? (() => Date.now());
  const classify = deps.classify ?? defaultClassify;
  const buckets = new Map<string, Bucket>();

  return async (c: Context<AppEnv>, next: Next) => {
    const principal = c.get('principal');
    const cls = classify(c);
    // A chave inclui o workspace: dois usuários de tenants diferentes nunca compartilham
    // orçamento, mesmo que o `userId` colida (um vindo de OIDC, outro de chave da casa).
    const key = `${principal.workspaceId}:${principal.userId ?? '-'}:${cls}`;
    const limit = cls === 'read' ? deps.config.read : deps.config.write;
    const t = now();

    let bucket = buckets.get(key);
    if (bucket === undefined || t >= bucket.resetAt) {
      bucket = { count: 0, resetAt: t + deps.config.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'rate_limited', retry_after_seconds: retryAfterSec }, 429);
    }

    // Poda oportunista: sem ela o Map cresce com um bucket por principal para sempre, e um
    // registry com muitos tenants transformaria o rate limiter num vazamento de memória.
    // Roda só quando o Map fica grande, para não pagar varredura em toda requisição.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (t >= b.resetAt) buckets.delete(k);
    }

    return next();
  };
}
