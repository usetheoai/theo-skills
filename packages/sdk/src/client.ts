import { classifyError, classifyHttpStatus, type ClassifiedError } from './error-classifier.js';

export interface Skill {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly score?: number;
  readonly origin?: 'own' | 'public';
}

export interface SkillsClientOptions {
  readonly baseUrl: string;
  readonly auth?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Tentativas totais em erro transitório (1 = sem retentativa). */
  readonly attempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Cliente já ATRELADO a um workspace — o binding vem da credencial. */
export interface WorkspaceClient {
  retrieve(query: string, topK?: number): Promise<Skill[]>;
  get(skillId: string): Promise<Skill | null>;
  revisions(skillId: string): Promise<{ revision_id: string; version: string | null }[]>;
}

export class SkillsApiError extends Error {
  constructor(readonly classified: ClassifiedError) {
    super(classified.message);
    this.name = 'SkillsApiError';
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * `withWorkspace` — binding de workspace (M16 DoD #1).
 *
 * O nome diz "com workspace", mas o workspace NÃO é parâmetro: ele vem da credencial, e o
 * que a função entrega é um cliente cujas operações já estão atreladas a ela. É o mesmo
 * desenho estrutural dos stores e dos retrievers — não existe caminho que produza uma
 * chamada sem tenant, porque não existe cliente sem credencial.
 *
 * Passar `workspaceId` aqui pareceria mais explícito e seria mais frágil: um SDK que aceita
 * o tenant por argumento convida quem o usa a lê-lo de um lugar controlável pelo usuário.
 */
export function withWorkspace(opts: SkillsClientOptions): WorkspaceClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const sleep = opts.sleep ?? defaultSleep;
  const headers: Record<string, string> = opts.auth === undefined ? {} : { authorization: `Bearer ${opts.auth}` };

  async function request<T>(path: string): Promise<T | 'not_found'> {
    let ultimo: ClassifiedError | null = null;
    for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
      try {
        const res = await doFetch(`${opts.baseUrl}${path}`, { headers });
        if (res.ok) return (await res.json()) as T;
        if (res.status === 404) return 'not_found';

        const c = classifyHttpStatus(res.status);
        if (!c.retryable) throw new SkillsApiError(c);
        ultimo = c;

        // Honra `Retry-After` quando o servidor o envia — foi para isso que o cabeçalho
        // entrou no rate limit e na quota. Ignorá-lo e aplicar backoff próprio é o cliente
        // decidindo que sabe mais que o servidor sobre quando ele estará pronto.
        const ra = Number(res.headers.get('Retry-After') ?? '');
        const esperaMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2 ** (tentativa - 1) * 200;
        if (tentativa < attempts) await sleep(esperaMs);
      } catch (err) {
        if (err instanceof SkillsApiError) throw err;
        const c = classifyError(err);
        if (!c.retryable) throw new SkillsApiError(c);
        ultimo = c;
        if (tentativa < attempts) await sleep(2 ** (tentativa - 1) * 200);
      }
    }
    throw new SkillsApiError(ultimo ?? { kind: 'permanent', retryable: false, message: 'falhou' });
  }

  return {
    async retrieve(query, topK = 5) {
      const r = await request<{ results?: Skill[] }>(
        `/v1/skills:retrieve?query=${encodeURIComponent(query)}&top_k=${String(topK)}`,
      );
      return r === 'not_found' ? [] : (r.results ?? []);
    },
    async get(skillId) {
      const r = await request<Skill>(`/v1/skills/${encodeURIComponent(skillId)}`);
      return r === 'not_found' ? null : r;
    },
    async revisions(skillId) {
      const r = await request<{ revisions?: { revision_id: string; version: string | null }[] }>(
        `/v1/skills/${encodeURIComponent(skillId)}/revisions`,
      );
      return r === 'not_found' ? [] : (r.revisions ?? []);
    },
  };
}
