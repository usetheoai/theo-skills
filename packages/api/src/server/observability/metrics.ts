import { type Context, type MiddlewareHandler, type Next } from 'hono';

import { type Logger } from '../logger.js';
import { type AppEnv } from '../principal-context.js';

import { resolveTraceId } from './trace-context.js';

/** Amostra de uma requisição — o que os agregados abaixo consomem. */
export interface RequestSample {
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly durationMs: number;
  readonly workspaceId: string;
}

export interface RouteStats {
  readonly count: number;
  readonly errors: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

/**
 * Agregador de latência por rota (M17 DoD #1 e #5).
 *
 * Guarda uma JANELA DESLIZANTE de amostras por rota, não a série inteira: o objetivo é
 * responder "qual o p95 agora?" para o SLO, e reter tudo transformaria o observador num
 * vazamento de memória — o modo clássico de a instrumentação derrubar o serviço que ela
 * deveria vigiar.
 */
export class MetricsRegistry {
  private readonly samples = new Map<string, number[]>();
  private readonly counts = new Map<string, { total: number; errors: number }>();

  constructor(private readonly windowSize = 1000) {}

  record(s: RequestSample): void {
    const key = `${s.method} ${s.route}`;
    const arr = this.samples.get(key) ?? [];
    arr.push(s.durationMs);
    // Descarta o mais antigo — janela fixa, memória limitada por rota.
    if (arr.length > this.windowSize) arr.shift();
    this.samples.set(key, arr);

    const c = this.counts.get(key) ?? { total: 0, errors: 0 };
    c.total += 1;
    if (s.status >= 500) c.errors += 1;
    this.counts.set(key, c);
  }

  stats(route: string, method = 'GET'): RouteStats | null {
    const key = `${method} ${route}`;
    const arr = this.samples.get(key);
    const c = this.counts.get(key);
    if (arr === undefined || c === undefined || arr.length === 0) return null;
    const ord = [...arr].sort((a, b) => a - b);
    // Percentil por índice — `ceil(p * n) - 1`, o método "nearest rank". Sem interpolação de
    // propósito: com janela pequena a interpolação inventa um valor que nenhuma requisição
    // teve, e o SLO passa a ser comparado contra ficção.
    const at = (p: number): number => ord[Math.max(0, Math.ceil(p * ord.length) - 1)] ?? 0;
    return { count: c.total, errors: c.errors, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) };
  }

  snapshot(): Record<string, RouteStats> {
    const out: Record<string, RouteStats> = {};
    for (const key of this.samples.keys()) {
      const [method, ...rest] = key.split(' ');
      const s = this.stats(rest.join(' '), method);
      if (s !== null) out[key] = s;
    }
    return out;
  }
}

export interface ObservabilityDeps {
  readonly registry: MetricsRegistry;
  readonly logger: Logger;
  readonly now?: () => number;
}

/**
 * Middleware de observabilidade (M17 DoD #1).
 *
 * Construído SOBRE o `trace-context` do M9 — `resolveTraceId` já sabe honrar um
 * `traceparent` recebido e gerar um novo quando ele falta. Reimplementar a propagação aqui
 * criaria dois ids para a mesma requisição, e a correlação entre HTTP, operação, job e
 * webhook (que o M9 construiu) se quebraria em silêncio.
 *
 * Emite UMA linha por requisição, com o trace id, o workspace e a latência — o suficiente
 * para responder "quem foi afetado e por quanto tempo" sem precisar de um backend de traces.
 */
export function createObservabilityMiddleware(deps: ObservabilityDeps): MiddlewareHandler<AppEnv> {
  const now = deps.now ?? (() => performance.now());
  return async (c: Context<AppEnv>, next: Next) => {
    const traceId = resolveTraceId(c.req.header('traceparent'));
    const start = now();
    await next();
    const durationMs = now() - start;

    // `routePath` agrupa por PADRÃO (`/v1/skills/:id`), não por valor. Agregar pela URL
    // concreta produziria uma série por id de skill — cardinalidade ilimitada, que é como
    // uma métrica bem-intencionada derruba o backend de observabilidade.
    const route = c.req.routePath;
    // O principal pode não existir: rotas públicas e de distribuição correm antes do auth.
    const workspaceId = ((): string => {
      try {
        return c.get('principal').workspaceId;
      } catch {
        return '-';
      }
    })();

    deps.registry.record({ route, method: c.req.method, status: c.res.status, durationMs, workspaceId });
    deps.logger.info(
      {
        trace_id: traceId,
        route,
        method: c.req.method,
        status: c.res.status,
        duration_ms: Math.round(durationMs * 100) / 100,
        workspace_id: workspaceId,
      },
      'request',
    );
  };
}

/** SLO declarado do retrieve (M17 DoD #5). */
export const RETRIEVE_SLO_P95_MS = 200;

export interface SloBreach {
  readonly route: string;
  readonly p95Ms: number;
  readonly targetMs: number;
}

/**
 * Verifica o SLO e devolve a violação, ou `null`.
 *
 * Devolver em vez de logar direto é o que permite ao chamador decidir o canal (alarme, painel,
 * teste). Um SLO que só existe como linha de log não é um alarme — é um registro que alguém
 * talvez leia depois do incidente.
 */
export function checkRetrieveSlo(registry: MetricsRegistry, minSamples = 20): SloBreach | null {
  const s = registry.stats('/v1/skills:retrieve');
  // Poucas amostras não sustentam um p95: alarmar com 3 requisições produziria ruído que
  // treina o time a ignorar o alarme — o mesmo custo do falso-positivo no gate de qualidade.
  if (s === null || s.count < minSamples) return null;
  if (s.p95Ms <= RETRIEVE_SLO_P95_MS) return null;
  return { route: '/v1/skills:retrieve', p95Ms: s.p95Ms, targetMs: RETRIEVE_SLO_P95_MS };
}
