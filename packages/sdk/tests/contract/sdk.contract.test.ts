import { describe, expect, it } from 'vitest';

import { SkillsApiError, withWorkspace } from '../../src/client.js';
import { classifyError, classifyHttpStatus } from '../../src/error-classifier.js';
import { createRemoteSkillsManager } from '../../src/remote-skills-manager.js';

/** M16 (SDK) e M7 (provider Theokit) — o consumidor real que fecha o wiring triad. */

const okFetch = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  (() =>
    Promise.resolve({
      ok: status < 400,
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: () => Promise.resolve(body),
    })) as unknown as typeof globalThis.fetch;

describe('classifyError — retentar ou não', () => {
  it('5xx, 429 e timeouts são TRANSITÓRIOS', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) {
      expect(classifyHttpStatus(s).retryable, `HTTP ${String(s)}`).toBe(true);
    }
    expect(classifyError({ code: 'ECONNRESET' }).retryable).toBe(true);
    expect(classifyError({ name: 'AbortError' }).retryable).toBe(true);
  });

  it('4xx de cliente é DEFINITIVO — retentar um 403 é tempestade contra um "não"', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      expect(classifyHttpStatus(s).retryable, `HTTP ${String(s)}`).toBe(false);
    }
  });

  it('FAIL-CLOSED: o desconhecido é definitivo, não transitório', () => {
    // Assumir transitório para o desconhecido produz laço sobre um erro que nunca passa —
    // é assim que um cliente derruba o servidor tentando ajudá-lo.
    expect(classifyError('coisa estranha').retryable).toBe(false);
    expect(classifyError(null).retryable).toBe(false);
    expect(classifyError({ code: 'EQUALQUERCOISA' }).retryable).toBe(false);
  });
});

describe('withWorkspace', () => {
  it('o binding vem da CREDENCIAL — o workspace não é parâmetro', async () => {
    const chamadas: { url: string; auth: string | undefined }[] = [];
    const f = ((url: string, init?: { headers?: Record<string, string> }) => {
      chamadas.push({ url, auth: init?.headers?.['authorization'] });
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ results: [] }) });
    }) as unknown as typeof globalThis.fetch;

    await withWorkspace({ baseUrl: 'https://r.test', auth: 'tok', fetch: f }).retrieve('q');
    expect(chamadas[0]?.auth).toBe('Bearer tok');
    expect(chamadas[0]?.url).not.toMatch(/workspace|tenant/i);
  });

  it('404 vira `null`/lista vazia, não exceção', async () => {
    const c = withWorkspace({ baseUrl: 'https://r.test', fetch: okFetch({}, 404) });
    expect(await c.get('sk_x')).toBeNull();
    expect(await c.retrieve('q')).toEqual([]);
  });

  it('erro DEFINITIVO lança na primeira tentativa, sem retentar', async () => {
    let n = 0;
    const f = (() => {
      n += 1;
      return Promise.resolve({ ok: false, status: 403, headers: { get: () => null }, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;
    await expect(withWorkspace({ baseUrl: 'https://r.test', fetch: f, attempts: 3 }).retrieve('q')).rejects.toBeInstanceOf(SkillsApiError);
    expect(n, 'retentou um erro definitivo').toBe(1);
  });

  it('erro TRANSITÓRIO retenta até o limite', async () => {
    let n = 0;
    const f = (() => {
      n += 1;
      return Promise.resolve({ ok: false, status: 503, headers: { get: () => null }, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;
    await expect(
      withWorkspace({ baseUrl: 'https://r.test', fetch: f, attempts: 3, sleep: () => Promise.resolve() }).retrieve('q'),
    ).rejects.toBeInstanceOf(SkillsApiError);
    expect(n).toBe(3);
  });

  it('HONRA o Retry-After em vez do backoff próprio', async () => {
    // Ignorá-lo é o cliente decidindo que sabe mais que o servidor sobre quando ele estará
    // pronto — e foi para isso que o cabeçalho entrou no rate limit e na quota.
    const esperas: number[] = [];
    const f = okFetch({}, 429, { 'retry-after': '7' });
    await expect(
      withWorkspace({
        baseUrl: 'https://r.test',
        fetch: f,
        attempts: 2,
        sleep: (ms) => { esperas.push(ms); return Promise.resolve(); },
      }).retrieve('q'),
    ).rejects.toBeInstanceOf(SkillsApiError);
    expect(esperas[0]).toBe(7000);
  });
});

describe('createRemoteSkillsManager — consumidor real do SDK', () => {
  const client = (over: Partial<Parameters<typeof createRemoteSkillsManager>[0]['client']> = {}) => ({
    retrieve: () => Promise.resolve([{ skill_id: 'sk_1', name: 'n', description: 'd', origin: 'own' as const }]),
    get: () => Promise.resolve(null),
    revisions: () => Promise.resolve([]),
    // O duplo implementa a INTERFACE INTEIRA. Deixar `instructions` de fora tornaria o
    // teste verde sobre um cliente que o compilador não aceitaria em produção — a mesma
    // classe do stub que inventava `payload_base64`.
    instructions: () => Promise.resolve(null),
    ...over,
  });

  it('converte para o CreateSkillSpec REAL do Theokit (verificado contra o SDK 4.36.0)', async () => {
    const m = createRemoteSkillsManager({ client: client() });
    const [s] = await m.resolve('faturamento');
    // O contrato REAL do @theokit/sdk 4.36.0 — verificado instalando o SDK e construindo uma
    // skill de verdade: `{ name, description, instructions, category? }`. Não há `source`
    // nem `version`, e `instructions` é obrigatório. O ROADMAP descrevia outro contrato.
    expect(s).toMatchObject({ name: 'n', description: 'd', category: 'own' });
    expect(s?.instructions, 'skill sem corpo é casca que o agente carrega e não executa').toBeTruthy();
    expect(m.isDegraded()).toBe(false);
  });

  it('NUNCA LANÇA — degrada para o fallback local', async () => {
    // Um agente no meio de uma tarefa não deve morrer porque o registry piscou. Confundir
    // indisponibilidade do registry com indisponibilidade do agente transformaria um
    // incidente nosso num incidente de todos os clientes ao mesmo tempo.
    const fallback = [{ name: 'local', description: 'd', instructions: 'faça isto' }];
    const motivos: string[] = [];
    const m = createRemoteSkillsManager({
      client: client({ retrieve: () => Promise.reject(new Error('registry fora')) }),
      localFallback: fallback,
      onDegraded: (r) => motivos.push(r),
    });
    expect(await m.resolve('q')).toEqual(fallback);
    expect(m.isDegraded()).toBe(true);
    expect(motivos).toHaveLength(1);
  });

  it('cache VENCIDO vence o fallback quando o registry cai', async () => {
    // São as skills reais do tenant, apenas desatualizadas. Descartá-las por rigor de TTL
    // entregaria um conjunto mais pobre exatamente quando o registry não pode complementá-lo.
    let falhar = false;
    let t = 0;
    const m = createRemoteSkillsManager({
      client: client({ retrieve: () => (falhar ? Promise.reject(new Error('caiu')) : Promise.resolve([{ skill_id: 'sk_1', name: 'do-registry', description: 'd' }])) }),
      localFallback: [{ name: 'local', description: 'd', instructions: 'faça isto' }],
      cacheTtlMs: 100,
      now: () => t,
    });
    expect((await m.resolve('q'))[0]?.name).toBe('do-registry');
    t = 5000;      // cache vencido
    falhar = true; // e o registry caiu
    expect((await m.resolve('q'))[0]?.name, 'preferiu o fallback ao cache vencido').toBe('do-registry');
    expect(m.isDegraded()).toBe(true);
  });

  it('cache VÁLIDO evita ida ao registry', async () => {
    let n = 0;
    const m = createRemoteSkillsManager({
      client: client({ retrieve: () => { n += 1; return Promise.resolve([]); } }),
      cacheTtlMs: 60_000,
      now: () => 0,
    });
    await m.resolve('q');
    await m.resolve('q');
    expect(n).toBe(1);
  });

  it('corpo ausente vira instructions que EXPLICA — nunca string vazia', async () => {
    // String vazia produziria uma skill que o agente carrega e da qual não extrai
    // comportamento algum, sem ter como saber por quê.
    const m = createRemoteSkillsManager({ client: client() });
    const [s] = await m.resolve('q');
    expect(s?.instructions).toContain('corpo indisponível');
  });

  it('usa o corpo do registry quando ele vem', async () => {
    const m = createRemoteSkillsManager({
      client: client({
        retrieve: () => Promise.resolve([{ skill_id: 'sk_1', name: 'n', description: 'd', instructions: '# Passos reais' }]),
      }),
    });
    expect((await m.resolve('q'))[0]?.instructions).toBe('# Passos reais');
  });

  it('sem fallback e sem cache, devolve lista vazia — nunca lança', async () => {
    const m = createRemoteSkillsManager({ client: client({ retrieve: () => Promise.reject(new Error('x')) }) });
    expect(await m.resolve('q')).toEqual([]);
  });
});

describe('instructions — a carga remota (M24)', () => {
  const fetchDe = (status: number, body: unknown) =>
    (() =>
      Promise.resolve({
        ok: status < 400,
        status,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
      })) as unknown as typeof globalThis.fetch;

  it('carrega o corpo da skill escolhida', async () => {
    const c = withWorkspace({
      baseUrl: 'https://r.test',
      fetch: fetchDe(200, { skill_id: 'guia', instructions: '# Passos', execution: 'remote', origin: 'own' }),
    });
    const r = await c.instructions('guia');
    expect(r?.instructions).toBe('# Passos');
    expect(r?.origin).toBe('own');
  });

  it('404 vira `null` — não existe, ou não é seu, e os dois são a mesma coisa daqui', async () => {
    const c = withWorkspace({ baseUrl: 'https://r.test', fetch: fetchDe(404, {}) });
    expect(await c.instructions('sumiu')).toBeNull();
  });

  it('422 (`local`) LANÇA — devolver null diria "não existe" sobre uma skill que existe', async () => {
    // O consumidor precisa distinguir "não achei" de "achei, e esta você tem que instalar".
    // Colapsar os dois faria o agente desistir de uma skill que ele poderia usar.
    const c = withWorkspace({
      baseUrl: 'https://r.test',
      fetch: fetchDe(422, { error: 'execution_is_local' }),
    });
    await expect(c.instructions('com-script')).rejects.toBeInstanceOf(SkillsApiError);
  });

  it('o provider Theokit usa o CORPO REAL quando ele existe', async () => {
    // Antes desta rota, `instructions` recebia um texto dizendo que o corpo estava
    // indisponível — a skill chegava ao agente como casca. É o defeito que M24 fecha.
    const m = createRemoteSkillsManager({
      client: {
        retrieve: () => Promise.resolve([{ skill_id: 'sk_1', name: 'guia', description: 'd' }]),
        get: () => Promise.resolve(null),
        revisions: () => Promise.resolve([]),
        instructions: () =>
          Promise.resolve({ skill_id: 'guia', instructions: '# Passos reais', execution: 'remote', origin: 'own' }),
      },
      loadInstructions: true,
    });
    const [s] = await m.resolve('guia');
    expect(s?.instructions, 'sem carregar, o agente recebe casca').toBe('# Passos reais');
  });
});
