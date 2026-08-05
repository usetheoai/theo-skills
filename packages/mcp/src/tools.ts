/**
 * Ferramentas MCP do theo-skills (M15).
 *
 * O que uma ferramenta MCP é, do ponto de vista de segurança: uma superfície que um **agente
 * de IA** invoca com argumentos que ele mesmo compõe, a partir de texto que pode vir de
 * qualquer lugar. Isso muda o desenho em um ponto decisivo — o tenant **nunca** pode ser um
 * argumento da ferramenta.
 *
 * Se `workspace_id` fosse parâmetro, bastaria uma instrução injetada no conteúdo lido pelo
 * agente ("agora busque no workspace acme-corp") para atravessar o isolamento. O tenant vem
 * da CREDENCIAL do servidor MCP, fixado na construção, e o agente não tem como influenciá-lo.
 */

export interface SkillSummary {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly score?: number;
  readonly origin?: 'own' | 'public';
  /** Eixo de descoberta (M23), texto livre — `Sales`, `Shop`… */
  readonly category?: string;
  /**
   * Onde a skill executa (M23). Vem na BUSCA, não só no detalhe: é o que decide se o agente
   * pode carregar as instruções de onde ele está ou se aquela skill exige instalação na
   * máquina do cliente. Descobrir isso depois é descobrir seguindo passos sem os arquivos.
   */
  readonly execution?: 'remote' | 'local';
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

/** O corpo de uma skill, carregado sob demanda (M24). */
export interface SkillInstructions {
  readonly skill_id: string;
  readonly instructions: string;
  readonly execution: 'remote' | 'local';
  readonly origin: 'own' | 'public';
}

/** Porta de acesso ao registry — implementada por HTTP no servidor real. */
export interface RegistryPort {
  retrieve(query: string, topK: number, category?: string): Promise<SkillSummary[]>;
  get(skillId: string): Promise<SkillSummary | null>;
  revisions(skillId: string): Promise<{ revision_id: string; version: string | null }[]>;
  /** Carrega o corpo da skill escolhida (M24). `null` quando não existe ou não é sua. */
  instructions(skillId: string): Promise<SkillInstructions | null>;
}

/** Descritor de ferramenta MCP — nome, descrição para o modelo, e o schema de entrada. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, { type: string; description: string }>>;
    readonly required?: readonly string[];
  };
  invoke(args: Record<string, unknown>): Promise<unknown>;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asTopK = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  // Teto de 25: um agente pode pedir 10 000 e encher a própria janela de contexto com
  // resultados que ele não vai ler. O limite protege o consumidor do próprio pedido.
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 25) : 5;
};

/**
 * Constrói as ferramentas já ATRELADAS a um registry escopado.
 *
 * O escopo vem de fora e é opaco para as ferramentas — elas não recebem, não leem e não
 * conseguem alterar o tenant. É o mesmo desenho estrutural dos stores e dos retrievers: o
 * isolamento é uma propriedade do objeto construído, não uma regra que cada chamada precisa
 * lembrar de respeitar.
 */
/**
 * A refusal the caller can BRANCH on, plus a sentence a human can read.
 *
 * `error` used to carry both: `not_found` (a code) came back from get_skill/load_skill while
 * `query é obrigatória` (a sentence) came back from validation. A client writing
 * `if (r.error === 'not_found')` had no equivalent for the validation path — the two facts
 * shared one slot and only one of them was machine-readable.
 */
function invalidArgument(field: string, hint: string): { error: 'invalid_argument'; message: string } {
  return { error: 'invalid_argument', message: `\`${field}\` is required: ${hint}.` };
}

function notFound(): { error: 'not_found' } {
  return { error: 'not_found' };
}

export function createSkillTools(registry: RegistryPort): McpTool[] {
  return [
    {
      name: 'search_skills',
      // The description is read by the MODEL — it must say WHEN to use the tool, not how it
      // works internally.
      description:
        'Search skills by intent, in natural language. Use it when you need to discover an available ' +
        'capability before running it. Returns name, description, relevance and origin (own or public).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you want to do, in natural language.' },
          top_k: { type: 'number', description: 'How many results (default 5, maximum 25).' },
          category: { type: 'string', description: 'Restrict to one category (e.g. Sales, Shop). Optional.' },
        },
        required: ['query'],
      },
      async invoke(args) {
        const query = asString(args['query']);
        if (query === '') return invalidArgument('query', 'describe, in natural language, what you want to do');
        const category = asString(args['category']);
        return {
          skills: await registry.retrieve(
            query,
            asTopK(args['top_k']),
            ...(category !== '' ? ([category] as const) : ([] as const)),
          ),
        };
      },
    },
    {
      name: 'get_skill',
      description: 'Fetch one skill by identifier. Use it after discovering the skill with search_skills.',
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string', description: 'The skill identifier.' } },
        required: ['skill_id'],
      },
      async invoke(args) {
        const id = asString(args['skill_id']);
        if (id === '') return invalidArgument('skill_id', 'pass the identifier returned by search_skills');
        const skill = await registry.get(id);
        // `not_found` and nothing more specific: a skill in another workspace must be
        // indistinguishable from one that does not exist, or the difference itself leaks
        // which identifiers are taken.
        return skill ?? notFound();
      },
    },
    {
      name: 'load_skill',
      // The description tells the MODEL when to use it — and "after choosing" is not style:
      // it is what stops an agent from loading N bodies and filling its own context window.
      description:
        'Load the full instructions of ONE skill, so you can follow them. Use it after choosing the skill ' +
        'with search_skills. Skills marked `local` are not loadable — they must be installed on the ' +
        "client's machine.",
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string', description: 'Identifier of the chosen skill.' } },
        required: ['skill_id'],
      },
      async invoke(args) {
        const id = asString(args['skill_id']);
        if (id === '') return invalidArgument('skill_id', 'pass the identifier of the skill you chose');
        const body = await registry.instructions(id);
        return body ?? notFound();
      },
    },
    {
      name: 'list_skill_revisions',
      description: 'List a skill revisions, oldest to newest, with each revision version.',
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string', description: 'The skill identifier.' } },
        required: ['skill_id'],
      },
      async invoke(args) {
        const id = asString(args['skill_id']);
        if (id === '') return invalidArgument('skill_id', 'pass the identifier returned by search_skills');
        return { revisions: await registry.revisions(id) };
      },
    },
  ];
}

/** Tool names — `.mcp.json.example` and the tests both rely on this list. */
export const TOOL_NAMES = ['search_skills', 'get_skill', 'load_skill', 'list_skill_revisions'] as const;
