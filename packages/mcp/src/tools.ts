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
export function createSkillTools(registry: RegistryPort): McpTool[] {
  return [
    {
      name: 'search_skills',
      // A descrição é lida pelo MODELO — ela precisa dizer quando usar, não como funciona.
      description:
        'Busca skills por intenção em linguagem natural. Use quando precisar descobrir uma capacidade ' +
        'disponível antes de executá-la. Retorna nome, descrição, relevância e origem (própria ou pública).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'O que você quer fazer, em linguagem natural.' },
          top_k: { type: 'number', description: 'Quantos resultados (padrão 5, máximo 25).' },
          category: { type: 'string', description: 'Restringe a uma categoria (ex.: Sales, Shop). Opcional.' },
        },
        required: ['query'],
      },
      async invoke(args) {
        const query = asString(args['query']);
        if (query === '') return { error: 'query é obrigatória' };
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
      description: 'Obtém uma skill pelo identificador. Use depois de descobri-la com search_skills.',
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string', description: 'Identificador da skill.' } },
        required: ['skill_id'],
      },
      async invoke(args) {
        const id = asString(args['skill_id']);
        if (id === '') return { error: 'skill_id é obrigatório' };
        const skill = await registry.get(id);
        // `not_found` em vez de erro: uma skill de outro workspace é indistinguível de
        // inexistente, e o agente não deve receber sinal diferente para os dois casos.
        return skill ?? { error: 'not_found' };
      },
    },
    {
      name: 'load_skill',
      // A descrição diz ao MODELO quando usar — e o "depois de escolher" não é estilo: é o
      // que evita o agente carregar N corpos e encher a própria janela de contexto.
      description:
        'Carrega as instruções completas de UMA skill, para segui-las. Use depois de escolher a skill ' +
        'em search_skills. Skills marcadas `local` não são carregáveis — elas precisam ser instaladas ' +
        'na máquina do cliente.',
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string', description: 'Identificador da skill escolhida.' } },
        required: ['skill_id'],
      },
      async invoke(args) {
        const id = asString(args['skill_id']);
        if (id === '') return { error: 'skill_id é obrigatório' };
        const corpo = await registry.instructions(id);
        return corpo ?? { error: 'not_found' };
      },
    },
    {
      name: 'list_skill_revisions',
      description: 'Lista as revisões de uma skill, da mais antiga à mais recente, com a versão de cada uma.',
      inputSchema: {
        type: 'object',
        properties: { skill_id: { type: 'string', description: 'Identificador da skill.' } },
        required: ['skill_id'],
      },
      async invoke(args) {
        const id = asString(args['skill_id']);
        if (id === '') return { error: 'skill_id é obrigatório' };
        return { revisions: await registry.revisions(id) };
      },
    },
  ];
}

/** Nomes das ferramentas — o `.mcp.json.example` e os testes se apoiam nesta lista. */
export const TOOL_NAMES = ['search_skills', 'get_skill', 'load_skill', 'list_skill_revisions'] as const;
