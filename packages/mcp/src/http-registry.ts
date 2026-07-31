import { type RegistryPort, type SkillSummary } from './tools.js';

export interface HttpRegistryOptions {
  readonly baseUrl: string;
  /**
   * Credencial do SERVIDOR MCP — não do agente.
   *
   * É ela que determina o tenant, e é por isso que o `workspace_id` não é parâmetro de
   * ferramenta nenhuma: um agente compõe argumentos a partir de texto que pode conter
   * instrução injetada, e "busque no workspace acme-corp" atravessaria o isolamento se o
   * tenant viesse dali.
   */
  readonly auth: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** Adapter HTTP do {@link RegistryPort}. */
export function createHttpRegistry(opts: HttpRegistryOptions): RegistryPort {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const headers = { authorization: `Bearer ${opts.auth}` };

  return {
    async retrieve(query: string, topK: number): Promise<SkillSummary[]> {
      const url = `${opts.baseUrl}/v1/skills:retrieve?query=${encodeURIComponent(query)}&top_k=${String(topK)}`;
      const res = await doFetch(url, { headers });
      if (!res.ok) return [];
      const body = (await res.json()) as { results?: SkillSummary[] };
      return body.results ?? [];
    },

    async get(skillId: string): Promise<SkillSummary | null> {
      const res = await doFetch(`${opts.baseUrl}/v1/skills/${encodeURIComponent(skillId)}`, { headers });
      // 404 do registry vira `null`, e o `null` vira `not_found` na ferramenta: a skill de
      // outro workspace é indistinguível de inexistente em toda a cadeia.
      if (!res.ok) return null;
      return (await res.json()) as SkillSummary;
    },

    async revisions(skillId: string): Promise<{ revision_id: string; version: string | null }[]> {
      const res = await doFetch(`${opts.baseUrl}/v1/skills/${encodeURIComponent(skillId)}/revisions`, { headers });
      if (!res.ok) return [];
      const body = (await res.json()) as { revisions?: { revision_id: string; version: string | null }[] };
      return body.revisions ?? [];
    },
  };
}
