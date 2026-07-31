import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createNoopLogger } from '../../src/server/logger.js';
import {
  checkRetrieveSlo,
  createObservabilityMiddleware,
  MetricsRegistry,
  RETRIEVE_SLO_P95_MS,
} from '../../src/server/observability/metrics.js';
import { type AppEnv } from '../../src/server/principal-context.js';

/** M17 DoD #1 e #5 — observabilidade sobre o trace-context do M9, e o SLO com alarme. */

describe('MetricsRegistry', () => {
  const reg = (window?: number) => new MetricsRegistry(window);
  const feed = (r: MetricsRegistry, route: string, ...ms: number[]) => {
    for (const d of ms) r.record({ route, method: 'GET', status: 200, durationMs: d, workspaceId: 'ws' });
  };

  it('calcula percentis por nearest rank, sem interpolar', () => {
    // Sem interpolação de propósito: com janela pequena ela inventa um valor que nenhuma
    // requisição teve, e o SLO passaria a ser comparado contra ficção.
    const r = reg();
    feed(r, '/x', 10, 20, 30, 40, 50, 60, 70, 80, 90, 100);
    const s = r.stats('/x')!;
    expect(s.count).toBe(10);
    expect(s.p50Ms).toBe(50);
    expect(s.p95Ms).toBe(100);
  });

  it('conta erros 5xx separadamente — 4xx é do cliente, não do serviço', () => {
    const r = reg();
    r.record({ route: '/x', method: 'GET', status: 200, durationMs: 1, workspaceId: 'w' });
    r.record({ route: '/x', method: 'GET', status: 404, durationMs: 1, workspaceId: 'w' });
    r.record({ route: '/x', method: 'GET', status: 500, durationMs: 1, workspaceId: 'w' });
    const s = r.stats('/x')!;
    expect(s.count).toBe(3);
    expect(s.errors).toBe(1);
  });

  it('JANELA DESLIZANTE limita a memória — reter tudo derrubaria o serviço vigiado', () => {
    const r = reg(3);
    feed(r, '/x', 1, 2, 3, 100, 200, 300);
    const s = r.stats('/x')!;
    // Só as 3 últimas amostras contam para latência; a contagem total continua fiel.
    expect(s.p50Ms).toBe(200);
    expect(s.count).toBe(6);
  });

  it('rota sem amostra devolve null em vez de zero', () => {
    // Zero seria indistinguível de "rápido", e um SLO leria silêncio como saúde.
    expect(reg().stats('/nunca-chamada')).toBeNull();
  });
});

describe('createObservabilityMiddleware', () => {
  const build = (registry: MetricsRegistry) => {
    const app = new Hono<AppEnv>();
    app.use('*', createObservabilityMiddleware({ registry, logger: createNoopLogger() }));
    app.get('/v1/skills/:id', (c) => c.json({ ok: true }));
    app.get('/boom', (c) => c.json({ e: 1 }, 500));
    return app;
  };

  it('agrega por PADRÃO de rota, não por valor — cardinalidade limitada', async () => {
    // Agregar pela URL concreta produziria uma série por id de skill: cardinalidade
    // ilimitada, que é como uma métrica bem-intencionada derruba o backend.
    const r = new MetricsRegistry();
    const app = build(r);
    await app.request('/v1/skills/sk_1');
    await app.request('/v1/skills/sk_2');
    await app.request('/v1/skills/sk_3');

    expect(r.stats('/v1/skills/:id')?.count).toBe(3);
    expect(r.stats('/v1/skills/sk_1')).toBeNull();
  });

  it('registra o status real, inclusive 500', async () => {
    const r = new MetricsRegistry();
    await build(r).request('/boom');
    expect(r.stats('/boom')?.errors).toBe(1);
  });

  it('não quebra quando não há principal (rotas públicas correm antes do auth)', async () => {
    const r = new MetricsRegistry();
    const res = await build(r).request('/v1/skills/sk_1');
    expect(res.status).toBe(200);
  });

  it('honra o traceparent recebido — sem reimplementar a propagação do M9', async () => {
    // Reimplementar aqui criaria dois ids para a mesma requisição, e a correlação entre
    // HTTP, operação, job e webhook que o M9 construiu se quebraria em silêncio.
    const linhas: { trace_id?: string }[] = [];
    const app = new Hono<AppEnv>();
    app.use(
      '*',
      createObservabilityMiddleware({
        registry: new MetricsRegistry(),
        logger: { info: (o) => linhas.push(o as { trace_id?: string }), error: () => undefined },
      }),
    );
    app.get('/x', (c) => c.json({}));

    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    await app.request('/x', { headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` } });
    expect(linhas[0]?.trace_id).toBe(traceId);
  });
});

describe('checkRetrieveSlo', () => {
  const comLatencia = (n: number, ms: number) => {
    const r = new MetricsRegistry();
    for (let i = 0; i < n; i += 1) {
      r.record({ route: '/v1/skills:retrieve', method: 'GET', status: 200, durationMs: ms, workspaceId: 'w' });
    }
    return r;
  };

  it('não alarma dentro do SLO', () => {
    expect(checkRetrieveSlo(comLatencia(50, 10))).toBeNull();
  });

  it('ALARMA quando o p95 estoura, com o número medido', () => {
    const b = checkRetrieveSlo(comLatencia(50, RETRIEVE_SLO_P95_MS + 50));
    expect(b).toMatchObject({ route: '/v1/skills:retrieve', targetMs: RETRIEVE_SLO_P95_MS });
    expect(b!.p95Ms).toBeGreaterThan(RETRIEVE_SLO_P95_MS);
  });

  it('NÃO alarma com poucas amostras, mesmo lentas', () => {
    // Alarmar com 3 requisições produz ruído que treina o time a ignorar o alarme — o mesmo
    // custo do falso-positivo que já quebrou o gate de qualidade nesta base.
    expect(checkRetrieveSlo(comLatencia(3, 5000))).toBeNull();
  });

  it('não alarma sobre rota nunca chamada', () => {
    expect(checkRetrieveSlo(new MetricsRegistry())).toBeNull();
  });
});
