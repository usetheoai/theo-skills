import { type MatchedLeg, type RetrievedSkill } from '@usetheo/skills';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerRetrieveRoutes } from '../../src/server/handlers/retrieve.js';
import { createNoopLogger } from '../../src/server/logger.js';
import { type AppEnv } from '../../src/server/principal-context.js';

/**
 * M31 — a atribuição por perna SOBREVIVE até a fronteira HTTP.
 *
 * Por que este teste existe, sendo que `rrfFuse` já é coberto no core: hoje a propagação
 * funciona por ACIDENTE FELIZ de implementação — `handlers/retrieve.ts` devolve
 * `c.json({ trace_id, results })`, passando `results` adiante sem tocá-lo. Nenhuma linha
 * declara essa intenção.
 *
 * No dia em que alguém interpuser um `map` para renomear um campo, projetar colunas ou
 * "limpar" a resposta, `matched` some — e some em SILÊNCIO: o status continua 200, os
 * resultados continuam lá, os testes do core continuam verdes. O consumidor recebe um
 * resultado plausível e incompleto.
 *
 * É o mesmo modo de falha que a mescla do `rrfFuse` já documenta (campos que sumiam para
 * skills presentes nas duas listas). Este teste trava a fronteira, não o cálculo.
 *
 * SEM BANCO de propósito: a pergunta é sobre a forma que a rota devolve, não sobre a busca.
 * `createApp` monta o `retrieverFor` a partir do pool e não tem seam de injeção — criar um
 * só para este teste seria acoplar produção a teste (rung 1 da escada de parcimônia). O
 * registrador de rota aceita as deps diretamente, que é o ponto certo para exercitá-la.
 */
function appComResultados(results: readonly RetrievedSkill[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Sem middleware de principal de propósito: `getPrincipal` cai no `DEFAULT_PRINCIPAL`
  // quando nenhum resolver foi montado (a ponte legada single-tenant). Montar auth aqui
  // testaria auth, não a forma da resposta — e este teste é sobre a forma.
  registerRetrieveRoutes(app, {
    retrieverFor: () => ({
      retrieve: () => Promise.resolve([...results]),
    }),
    logger: createNoopLogger(),
  });
  return app;
}

const skill = (id: string, matched: readonly MatchedLeg[]): RetrievedSkill => ({
  skill_id: id,
  score: 0.03,
  name: id,
  description: `skill ${id}`,
  matched,
});

describe('GET /v1/skills:retrieve — a atribuição chega ao cliente (M31)', () => {
  it('carrega `matched` por resultado', async () => {
    const app = appComResultados([
      skill('a', [
        { leg: 'vector', rank: 1 },
        { leg: 'keyword', rank: 3 },
      ]),
    ]);

    const r = await app.request('/v1/skills:retrieve?query=triagem&top_k=5');
    expect(r.status).toBe(200);

    const body = (await r.json()) as { results: RetrievedSkill[] };
    expect(body.results[0]?.matched).toEqual([
      { leg: 'vector', rank: 1 },
      { leg: 'keyword', rank: 3 },
    ]);
  });

  it('asserta a FORMA, não valores fixos — perna conhecida e rank ≥ 1', async () => {
    // Valor fixo travaria o teste ao dado, não ao contrato: mudar o ranking do fixture
    // quebraria um teste que deveria falar sobre estrutura.
    const app = appComResultados([skill('b', [{ leg: 'keyword', rank: 2 }])]);

    const r = await app.request('/v1/skills:retrieve?query=x');
    const body = (await r.json()) as { results: RetrievedSkill[] };

    for (const m of body.results[0]?.matched ?? []) {
      expect(['vector', 'keyword']).toContain(m.leg);
      expect(m.rank).toBeGreaterThanOrEqual(1);
    }
  });

  it('resultado sem atribuição não inventa o campo', async () => {
    // `matched` é OPCIONAL e ausente significa "não informado", nunca "não casou". Um
    // handler que preenchesse `[]` por conveniência transformaria desconhecido em negativo.
    const app = appComResultados([
      { skill_id: 'c', score: 0.01, name: 'c', description: 'sem atribuição' },
    ]);

    const r = await app.request('/v1/skills:retrieve?query=x');
    const body = (await r.json()) as { results: RetrievedSkill[] };

    expect(body.results[0]).not.toHaveProperty('matched');
  });
});

describe('a métrica de runtime fecha a tríade de wiring (M31)', () => {
  it('o log do retrieve conta quantos resultados cada perna trouxe', async () => {
    // Sem isto a atribuição viveria só na RESPOSTA: quem integra enxergaria, quem OPERA não.
    // O M4 mediu o desequilíbrio entre as pernas numa avaliação offline; em produção não
    // havia sinal. Uma linha de log com dois inteiros torna o mesmo desequilíbrio observável
    // no ambiente onde ele de fato importa.
    const linhas: Record<string, unknown>[] = [];
    const app = new Hono<AppEnv>();
    registerRetrieveRoutes(app, {
      retrieverFor: () => ({
        retrieve: () =>
          Promise.resolve([
            skill('a', [{ leg: 'vector', rank: 1 }]),
            skill('b', [
              { leg: 'vector', rank: 2 },
              { leg: 'keyword', rank: 1 },
            ]),
          ]),
      }),
      logger: {
        ...createNoopLogger(),
        info: (obj: unknown) => linhas.push(obj as Record<string, unknown>),
      } as unknown as ReturnType<typeof createNoopLogger>,
    });

    await app.request('/v1/skills:retrieve?query=x');

    const retrieve = linhas.find((l) => 'latency_ms' in l);
    expect(retrieve?.['matched_vector']).toBe(2);
    expect(retrieve?.['matched_keyword']).toBe(1);
  });
});
