import { describe, expect, it } from 'vitest';

import { createHttpRegistry } from '../../src/http-registry.js';
import { createSkillTools, type RegistryPort, TOOL_NAMES } from '../../src/tools.js';

/**
 * M15 — ferramentas MCP, e o âncora de tenant que o DoD exige.
 *
 * A propriedade central: **o tenant nunca é argumento**. Um agente compõe argumentos a
 * partir de texto que pode vir de qualquer lugar; se `workspace_id` fosse parâmetro, uma
 * instrução injetada no conteúdo lido pelo agente atravessaria o isolamento.
 */

const fakeRegistry = (over: Partial<RegistryPort> = {}): RegistryPort => ({
  retrieve: () => Promise.resolve([{ skill_id: 'sk_1', name: 'n', description: 'd', score: 0.9, origin: 'own' }]),
  get: (id: string) => Promise.resolve(id === 'sk_1' ? { skill_id: 'sk_1', name: 'n', description: 'd' } : null),
  revisions: () => Promise.resolve([{ revision_id: 'rev_1', version: '1.0.0' }]),
  ...over,
});

const toolMap = (r: RegistryPort) => new Map(createSkillTools(r).map((t) => [t.name, t]));

describe('createSkillTools', () => {
  it('expõe exatamente as três ferramentas declaradas', () => {
    expect(createSkillTools(fakeRegistry()).map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('NENHUMA ferramenta aceita workspace/tenant como argumento', () => {
    // O teste mais importante do arquivo. Se um dia alguém adicionar `workspace_id` ao
    // schema "para flexibilidade", isto reprova — e a flexibilidade em questão é
    // exatamente o vetor de prompt injection que o desenho fecha.
    const proibidos = ['workspace', 'workspace_id', 'tenant', 'tenant_id', 'org', 'account'];
    const violacoes: string[] = [];
    for (const t of createSkillTools(fakeRegistry())) {
      for (const prop of Object.keys(t.inputSchema.properties)) {
        if (proibidos.some((p) => prop.toLowerCase().includes(p))) violacoes.push(`${t.name}.${prop}`);
      }
    }
    expect(violacoes, `ferramentas aceitando tenant por argumento: ${violacoes.join(', ')}`).toEqual([]);
  });

  it('search_skills devolve as skills, com origem', async () => {
    const r = await toolMap(fakeRegistry()).get('search_skills')!.invoke({ query: 'faturamento' });
    expect(r).toEqual({ skills: [{ skill_id: 'sk_1', name: 'n', description: 'd', score: 0.9, origin: 'own' }] });
  });

  it('search_skills LIMITA o top_k — um agente pode pedir 10 000', async () => {
    // Sem teto, o agente enche a própria janela de contexto com resultados que não vai ler.
    // O limite protege o consumidor do próprio pedido.
    let pedido = 0;
    const t = toolMap(fakeRegistry({ retrieve: (_q, k) => { pedido = k; return Promise.resolve([]); } }));
    await t.get('search_skills')!.invoke({ query: 'x', top_k: 10_000 });
    expect(pedido).toBe(25);
  });

  it('top_k inválido cai no padrão, sem explodir', async () => {
    let pedido = 0;
    const t = toolMap(fakeRegistry({ retrieve: (_q, k) => { pedido = k; return Promise.resolve([]); } }));
    for (const v of [undefined, 'abc', -5, 0]) {
      await t.get('search_skills')!.invoke({ query: 'x', top_k: v });
      expect(pedido, `top_k=${String(v)}`).toBe(5);
    }
  });

  it('query vazia devolve erro em vez de buscar tudo', async () => {
    let chamou = false;
    const t = toolMap(fakeRegistry({ retrieve: () => { chamou = true; return Promise.resolve([]); } }));
    expect(await t.get('search_skills')!.invoke({ query: '' })).toEqual({ error: 'query é obrigatória' });
    expect(chamou).toBe(false);
  });

  it('get_skill devolve `not_found` para skill que o tenant não alcança', async () => {
    // Indistinguível de inexistente — o agente não deve receber sinal diferente para
    // "existe mas não é sua" e "não existe".
    const t = toolMap(fakeRegistry());
    expect(await t.get('get_skill')!.invoke({ skill_id: 'sk_de_outro' })).toEqual({ error: 'not_found' });
  });

  it('toda ferramenta declara descrição útil para o MODELO e schema válido', () => {
    for (const t of createSkillTools(fakeRegistry())) {
      expect(t.description.length, `${t.name} sem descrição útil`).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(Object.keys(t.inputSchema.properties).length).toBeGreaterThan(0);
    }
  });
});

describe('createHttpRegistry — o tenant vem da CREDENCIAL', () => {
  it('envia a credencial do servidor, e nunca um workspace na URL', async () => {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const fakeFetch = ((url: string, init?: { headers?: Record<string, string> }) => {
      urls.push(url);
      if (init?.headers) headers.push(init.headers);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
    }) as unknown as typeof globalThis.fetch;

    const r = createHttpRegistry({ baseUrl: 'https://reg.test', auth: 'tok', fetch: fakeFetch });
    await r.retrieve('busca', 5);

    expect(headers[0]?.['authorization']).toBe('Bearer tok');
    expect(urls[0], 'a URL carrega workspace — o tenant deve vir só da credencial').not.toMatch(/workspace|tenant/i);
  });

  it('403 LANÇA — este teste travava o defeito, e foi corrigido junto com ele', async () => {
    // A versão anterior afirmava que TODA resposta não-ok virava `[]`/`null` "sem vazar
    // status ao agente". A intenção era boa (não expor detalhe de infra), mas o efeito era
    // mentir: `[]` diante de um 403 diz "nenhuma skill", quando a verdade é "não posso
    // perguntar". O agente segue a tarefa concluindo que o catálogo está vazio — a pior
    // resposta possível, porque é plausível.
    //
    // Só o 404 é valor de domínio (não existe / não é seu). O resto é falha, e falha se
    // declara. Registrado aqui porque um teste que trava o comportamento errado é mais
    // perigoso que a ausência de teste: ele defende o defeito de quem tentar corrigi-lo.
    const fail = (() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })) as unknown as typeof globalThis.fetch;
    const r = createHttpRegistry({ baseUrl: 'https://reg.test', auth: 't', fetch: fail });
    await expect(r.retrieve('q', 5)).rejects.toThrow(/HTTP 403/);
    await expect(r.get('sk_1')).rejects.toThrow(/HTTP 403/);
    await expect(r.revisions('sk_1')).rejects.toThrow(/HTTP 403/);
  });

  it('escapa o id na URL — um id hostil não monta rota', async () => {
    const urls: string[] = [];
    const f = ((u: string) => { urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }) as unknown as typeof globalThis.fetch;
    await createHttpRegistry({ baseUrl: 'https://reg.test', auth: 't', fetch: f }).get('../../admin/keys');
    expect(urls[0]).not.toContain('../');
  });
});

describe('createHttpRegistry — falha do registry não vira lista vazia', () => {
  const fetchStatus = (status: number) =>
    (() => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve({}) })) as unknown as typeof globalThis.fetch;

  it('404 é valor de DOMÍNIO: lista vazia / null, sem lançar', async () => {
    const r = createHttpRegistry({ baseUrl: 'https://r.test', auth: 't', fetch: fetchStatus(404) });
    expect(await r.retrieve('q', 5)).toEqual([]);
    expect(await r.get('sk_1')).toBeNull();
    expect(await r.revisions('sk_1')).toEqual([]);
  });

  it('503 LANÇA — `[]` diria "nenhuma skill" quando a verdade é "não consegui perguntar"', async () => {
    // O agente que recebe `[]` segue a tarefa concluindo que o catálogo está vazio. É a pior
    // resposta possível porque é plausível: um erro explícito ele sabe tratar.
    const r = createHttpRegistry({ baseUrl: 'https://r.test', auth: 't', fetch: fetchStatus(503) });
    await expect(r.retrieve('q', 5)).rejects.toThrow(/indisponível/);
    await expect(r.get('sk_1')).rejects.toThrow(/indisponível/);
    await expect(r.revisions('sk_1')).rejects.toThrow(/indisponível/);
  });

  it('401 também lança — credencial errada não é "catálogo vazio"', async () => {
    const r = createHttpRegistry({ baseUrl: 'https://r.test', auth: 'errada', fetch: fetchStatus(401) });
    await expect(r.retrieve('q', 5)).rejects.toThrow(/HTTP 401/);
  });
});
