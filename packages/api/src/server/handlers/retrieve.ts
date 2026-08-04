import { createId } from '@paralleldrive/cuid2';
import { buildLifecycleFilter } from '@usetheo/skills';
import { RetrieveParamsSchema } from '@usetheo/skills/contract';
import { type Hono } from 'hono';

import { type Logger } from '../logger.js';
import { type AppEnv, workspaceOf } from '../principal-context.js';
import { type DispatchingRetriever } from '../providers/retriever-selection.js';

/** Monotonic clock for latency measurement — distinct from the wall-clock in `time/clock.ts`
 * (`now(): number` ms via performance.now, NOT a Date). Internal; injectable via deps.clock. */
interface LatencyClock {
  now(): number;
}

const monotonicClock: LatencyClock = { now: () => performance.now() };

export interface RetrieveRoutesDeps {
  /**
   * Fábrica por workspace — NUNCA um retriever pronto.
   *
   * O tipo é o que carrega a garantia: sem um `workspaceId` em mãos não há como obter
   * um retriever, então a rota não consegue buscar "em tudo" nem por descuido. Mesmo
   * contrato dos `*StoreFor(ws)` vizinhos.
   */
  /**
   * Constrói o retriever para o inquilino, com um coletor de degradação POR REQUISIÇÃO.
   *
   * O coletor é parâmetro e não estado do módulo de propósito: duas buscas simultâneas, uma
   * degradada e outra não, não podem trocar de diagnóstico.
   */
  readonly retrieverFor: (
    workspaceId: string,
    onDegraded?: (perna: 'vector' | 'keyword') => void,
  ) => DispatchingRetriever;
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
      // O filtro que a ferramenta MCP já anunciava ao modelo e que a rota descartava: a
      // busca voltava sem restrição alguma. Resultado plausível, nunca erro — o modo mais
      // caro de errar, porque ninguém investiga uma resposta que parece certa.
      category: c.req.query('category'),
      // M32 — o opt-in do ciclo de vida. Ausentes, o default esconde rascunhos,
      // descontinuadas e desabilitadas: a descoberta serve quem procura algo para USAR.
      include_draft: c.req.query('include_draft'),
      include_deprecated: c.req.query('include_deprecated'),
      include_disabled: c.req.query('include_disabled'),
    });
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
    }
    const { query, top_k, strategy, category, include_draft, include_deprecated, include_disabled } =
      parsed.data;
    // A especificação de visibilidade nasce no DOMÍNIO a partir das flags da fronteira — a
    // rota não monta o predicado à mão (ADR D3).
    const lifecycle = buildLifecycleFilter({
      includeDraft: include_draft,
      includeDeprecated: include_deprecated,
      includeDisabled: include_disabled,
    });

    // O tenant vem do Principal resolvido na fronteira — nunca da query string nem do
    // corpo, que o cliente controla (M11 DoD #1).
    const workspaceId = workspaceOf(c);

    const start = clock.now();
    // Coletor POR REQUISIÇÃO — o sinal de degradação precisa chegar a ESTA resposta, e não
    // a um estado compartilhado entre requisições concorrentes. Duas buscas simultâneas, uma
    // degradada e outra não, não podem trocar de diagnóstico.
    const degradadas: string[] = [];
    const results = await deps.retrieverFor(workspaceId, (perna) => degradadas.push(perna)).retrieve({
      query,
      topK: top_k,
      strategy,
      ...(category !== undefined ? { category } : {}),
      lifecycle,
    });
    const latencyMs = clock.now() - start;

    deps.logger.info(
      {
        workspace_id: workspaceId,
        strategy,
        query_len: query.length,
        result_count: results.length,
        top_score: results[0]?.score ?? null,
        // M31 — quantos resultados cada perna trouxe, NESTA requisição.
        //
        // Fecha a tríade de wiring: sem isto a atribuição existiria só na resposta, e quem
        // OPERA continuaria sem enxergar o equilíbrio entre as pernas. O M4 mediu que a recall
        // é carregada pelo FTS (perna vetorial isolada em 0.308 sob o embedder stub) — mas
        // isso foi medido numa AVALIAÇÃO, offline. Em produção não havia sinal algum.
        //
        // Cardinalidade fixa de propósito: dois inteiros, não a lista de skills. Uma métrica
        // por skill viraria alta cardinalidade e o custo apareceria no armazenamento de
        // métricas, não aqui.
        matched_vector: results.filter((r) => r.matched?.some((m) => m.leg === 'vector')).length,
        matched_keyword: results.filter((r) => r.matched?.some((m) => m.leg === 'keyword')).length,
        latency_ms: latencyMs,
      },
      'retrieve',
    );
    // ADITIVO e ausente-significa-íntegro: se o campo viesse sempre, o consumidor teria de
    // inspecioná-lo a cada resposta para descobrir que está tudo bem. Assim o caso normal
    // fica silencioso e o anormal, explícito.
    //
    // O log de degradação serve quem OPERA; este campo serve quem INTEGRA. Um agente escolhe
    // qual skill carregar pelo ranking — com metade da busca fora ele escolhe pior e, sem
    // isto, sem saber que escolheu pior.
    return c.json(
      {
        trace_id: `trc_${createId()}`,
        results,
        ...(degradadas.length > 0 ? { degraded: { legs: degradadas } } : {}),
      },
      200,
    );
  });
}
