import { type RegistryPort, type SkillInstructions, type SkillSummary } from './tools.js';

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
/**
 * Erro do registry que NÃO é "não encontrado".
 *
 * A distinção existe porque colapsá-la mente para o agente: `[]` diante de um 503 diz
 * "nenhuma skill", quando a verdade é "não consegui perguntar". O agente então segue a tarefa
 * concluindo que o catálogo está vazio — e essa é a pior resposta possível, porque é
 * plausível. Um erro explícito ele sabe tratar; uma lista vazia falsa, não.
 */
export class RegistryUnavailableError extends Error {
  constructor(readonly status: number, readonly operation: string) {
    super(`registry unavailable at ${operation} (HTTP ${String(status)})`);
    this.name = 'RegistryUnavailableError';
  }
}

/** 404 é valor de DOMÍNIO (não existe / não é seu). Qualquer outro !ok é falha. */
function assertNaoEhFalha(res: { ok: boolean; status: number }, operacao: string): void {
  if (!res.ok && res.status !== 404) {
    throw new RegistryUnavailableError(res.status, operacao);
  }
}

export function createHttpRegistry(opts: HttpRegistryOptions): RegistryPort {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const headers = { authorization: `Bearer ${opts.auth}` };

  return {
    async retrieve(query: string, topK: number, category?: string): Promise<SkillSummary[]> {
      // A categoria é parametrizada na URL, escapada — é texto livre de terceiro, e
      // concatená-la crua seria injeção pela porta da frente.
      const filtro = category !== undefined && category !== '' ? `&category=${encodeURIComponent(category)}` : '';
      const url = `${opts.baseUrl}/v1/skills:retrieve?query=${encodeURIComponent(query)}&top_k=${String(topK)}${filtro}`;
      const res = await doFetch(url, { headers });
      assertNaoEhFalha(res, 'retrieve');
      if (!res.ok) return [];
      const body = (await res.json()) as { results?: SkillSummary[] };
      return body.results ?? [];
    },

    async get(skillId: string): Promise<SkillSummary | null> {
      const res = await doFetch(`${opts.baseUrl}/v1/skills/${encodeURIComponent(skillId)}`, { headers });
      // 404 do registry vira `null`, e o `null` vira `not_found` na ferramenta: a skill de
      // outro workspace é indistinguível de inexistente em toda a cadeia.
      assertNaoEhFalha(res, 'get');
      if (!res.ok) return null;
      return (await res.json()) as SkillSummary;
    },

    async instructions(skillId: string): Promise<SkillInstructions | null> {
      const res = await doFetch(`${opts.baseUrl}/v1/skills/${encodeURIComponent(skillId)}/instructions`, { headers });
      // 404 é valor de domínio (não existe / não é sua). 422 (`local`) e o resto são FALHA:
      // devolver `null` para um 422 diria "não existe" sobre uma skill que existe, e o
      // agente desistiria de algo que ele poderia instalar.
      assertNaoEhFalha(res, 'instructions');
      if (!res.ok) return null;
      return (await res.json()) as SkillInstructions;
    },

    async revisions(skillId: string): Promise<{ revision_id: string; version: string | null }[]> {
      const res = await doFetch(`${opts.baseUrl}/v1/skills/${encodeURIComponent(skillId)}/revisions`, { headers });
      assertNaoEhFalha(res, 'revisions');
      if (!res.ok) return [];
      const body = (await res.json()) as { revisions?: { revision_id: string; version: string | null }[] };
      return body.revisions ?? [];
    },
  };
}
