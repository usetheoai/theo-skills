import { createId } from '@paralleldrive/cuid2';
import { RetrieveParamsSchema } from '@usetheo/skills/contract';
import { type Hono } from 'hono';

import { type Logger } from '../logger.js';
import { type AppEnv } from '../principal-context.js';
import { type DispatchingRetriever } from '../providers/retriever-selection.js';

/** Monotonic clock for latency measurement — distinct from the wall-clock in `time/clock.ts`
 * (`now(): number` ms via performance.now, NOT a Date). Internal; injectable via deps.clock. */
interface LatencyClock {
  now(): number;
}

const monotonicClock: LatencyClock = { now: () => performance.now() };

export interface RetrieveRoutesDeps {
  readonly retriever: DispatchingRetriever;
  readonly logger: Logger;
  readonly clock?: LatencyClock;
}

/**
 * GET /v1/skills:retrieve — hybrid (lexical + vector) skill discovery with an
 * explicit per-result `score`. Emits a `retrieve` metric line carrying latency +
 * top score (the time-to-relevant-skill north-star signal).
 */
export function registerRetrieveRoutes(app: Hono<AppEnv>, deps: RetrieveRoutesDeps): void {
  const clock = deps.clock ?? monotonicClock;
  app.get('/v1/skills:retrieve', async (c) => {
    const parsed = RetrieveParamsSchema.safeParse({
      query: c.req.query('query'),
      top_k: c.req.query('topK') ?? c.req.query('top_k'),
      strategy: c.req.query('strategy'),
    });
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
    }
    const { query, top_k, strategy } = parsed.data;

    const start = clock.now();
    const results = await deps.retriever.retrieve({ query, topK: top_k, strategy });
    const latencyMs = clock.now() - start;

    deps.logger.info(
      { strategy, query_len: query.length, result_count: results.length, top_score: results[0]?.score ?? null, latency_ms: latencyMs },
      'retrieve',
    );
    return c.json({ trace_id: `trc_${createId()}`, results }, 200);
  });
}
