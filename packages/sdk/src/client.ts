import { classifyError, classifyHttpStatus, type ClassifiedError } from './error-classifier.js';

export interface Skill {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly score?: number;
  readonly origin?: 'own' | 'public';
  /** Corpo da skill, quando a rota o fornece. A busca devolve resumo; `get` pode trazê-lo. */
  readonly instructions?: string;
  /**
   * Ciclo de vida (M32): `active` · `draft` · `deprecated`.
   *
   * Sem este campo, um agente carrega uma skill DESCONTINUADA sem saber — é o cenário que a
   * DoD do M32 nomeia. Opcional porque um registry mais antigo simplesmente não o devolve, e
   * ausência não é o mesmo que `active`.
   */
  readonly lifecycle?: string;
  /** Por que foi descontinuada. Presente só quando `lifecycle === 'deprecated'`. */
  readonly deprecation_reason?: string;
  /** O que usar no lugar. Sem isto, saber que parou não diz o que fazer. */
  readonly superseded_by?: string;
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
/**
 * O corpo de UMA skill, carregado sob demanda (M24) — a segunda fase da descoberta.
 *
 * `origin` acompanha o corpo porque a decisão que o consumidor precisa tomar é justamente
 * essa: uma skill `public` é instrução de terceiro que o agente vai seguir.
 */
export interface SkillInstructions {
  readonly skill_id: string;
  readonly instructions: string;
  readonly execution: 'remote' | 'local';
  readonly origin: 'own' | 'public';
}

export interface WorkspaceClient {
  retrieve(query: string, topK?: number): Promise<Skill[]>;
  get(skillId: string): Promise<Skill | null>;
  revisions(skillId: string): Promise<{ revision_id: string; version: string | null }[]>;
  /**
   * Carrega o corpo da skill escolhida. `null` quando não existe (ou não é sua — daqui é a
   * mesma coisa); LANÇA quando a skill é `local`, porque "existe, e esta você instala" é
   * uma resposta diferente de "não achei", e colapsá-las faria o agente desistir de uma
   * skill que ele poderia usar.
   */
  instructions(skillId: string): Promise<SkillInstructions | null>;
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
/**
 * Remove do endereço APENAS o que duplicaria — o segmento final `/v1` — e nada além.
 *
 * O SDK já prefixa `/v1` em todo caminho, então um `--registry` terminando em `/v1` produzia
 * `/v1/v1/skills/...`. A tentação é apagar todo `/v1` da string; isso quebraria endereços
 * legítimos onde `v1` é o host (`v1.example.com`), é parte de um nome (`/service-v1`), é
 * outro segmento (`/v1beta`) ou não é o final (`/v1/extra`, onde o serviço vive abaixo).
 * Por isso a âncora `$`: o alvo é o segmento final, não a substring.
 */
export function normalizeBaseUrl(bruto: string): string {
  return bruto.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * O 404 veio desta API, ou de uma borda que não conhece este caminho?
 *
 * CONSERVADOR de propósito: só afirmo "endereço" com evidência POSITIVA de que não foi a API
 * que respondeu — um corpo HTML, que é a página do proxy. Exigir corpo tipado seria mais
 * preciso no papel e pior na prática: um 404 legítimo com corpo enxuto viraria "seu endereço
 * está errado", e o usuário caçaria configuração enquanto a verdade era que a skill não
 * existe. Trocar uma mensagem enganosa por outra não é conserto. Na dúvida, o comportamento
 * antigo permanece. Lê o cabeçalho, não o corpo — consumir o stream quebraria quem já usa o
 * cliente com respostas que só implementam `json()`.
 */
function pareceRespostaDaApi(contentType: string | null): boolean {
  if (contentType === null || contentType.trim() === '') return true;
  return !/text\/html|application\/xhtml/i.test(contentType);
}

export function withWorkspace(opts: SkillsClientOptions): WorkspaceClient {
  const base = normalizeBaseUrl(opts.baseUrl);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const sleep = opts.sleep ?? defaultSleep;
  const headers: Record<string, string> = opts.auth === undefined ? {} : { authorization: `Bearer ${opts.auth}` };

  async function request<T>(path: string): Promise<T | 'not_found'> {
    let last: ClassifiedError | null = null;
    for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
      try {
        const res = await doFetch(`${base}${path}`, { headers });
        if (res.ok) return (await res.json()) as T;
        if (res.status === 404) {
          // Só é "não encontrado" quando quem respondeu foi o SERVIÇO. Um 404 em HTML veio da
          // borda: o endereço não serve esta API. Devolver 'not_found' aqui fazia o CLI dizer
          // "skill não encontrada" — mandando o usuário procurar a skill, republicar e
          // conferir o nome, tudo no lugar errado, porque o defeito era o endereço.
          if (pareceRespostaDaApi(res.headers.get('content-type'))) return 'not_found';
          throw new SkillsApiError({
            kind: 'permanent',
            retryable: false,
            message:
              `the address ${base} did not answer ${path} as this API (404 in HTML, not in JSON). ` +
              'Check --registry: it is the service root, and /v1 is appended by the ' +
              'client. The skill may well exist — what did not answer was the address.',
          });
        }

        const c = classifyHttpStatus(res.status);
        if (!c.retryable) throw new SkillsApiError(c);
        last = c;

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
        last = c;
        if (tentativa < attempts) await sleep(2 ** (tentativa - 1) * 200);
      }
    }
    throw new SkillsApiError(last ?? { kind: 'permanent', retryable: false, message: 'request failed' });
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
    async instructions(skillId) {
      const r = await request<SkillInstructions>(`/v1/skills/${encodeURIComponent(skillId)}/instructions`);
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
