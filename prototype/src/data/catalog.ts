/**
 * Skills de exemplo para a tela de catálogo.
 *
 * INVENTADAS de propósito — do domínio do Theo (deploy, k8s, custo, incidentes).
 * NÃO são as 74 submissões do peer `microsoft/cat-agent-skills`: aquelas são de
 * autores terceiros sob MIT e usá-las exigiria atribuição (ver decisão aberta #3).
 *
 * Os campos espelham o que a API devolve hoje — `skillId`, `displayName`,
 * `description`, `revision`, `state` (contract/index.ts) — mais `tags` e `score`,
 * que a tela usa e o backend AINDA NÃO tem. Ver `CATALOG_GAPS`.
 */

export interface CatalogSkill {
  readonly skillId: string;
  readonly displayName: string;
  readonly description: string;
  /** NÃO existe no modelo hoje — ver CATALOG_GAPS. */
  readonly tags: readonly string[];
  readonly revision: number;
  readonly sizeKb: number;
  /** Payload traz scripts/ ou references/ além do SKILL.md. */
  readonly hasBundle: boolean;
  /** Ilustrativo. Score real vem do retrieve híbrido (M4) só quando há query. */
  readonly score: number;
}

export const CATALOG: readonly CatalogSkill[] = [
  {
    skillId: 'cloud-resource-manager',
    displayName: 'Cloud Resource Manager',
    description:
      'Cria, altera e remove recursos de nuvem do projeto a partir de linguagem natural, sempre mostrando o plano antes de aplicar.',
    tags: ['infra', 'cloud', 'terraform'],
    revision: 2,
    sizeKb: 82,
    hasBundle: true,
    score: 0.91,
  },
  {
    skillId: 'k8s-triage',
    displayName: 'Kubernetes Triage',
    description:
      'Diagnostica pods em CrashLoopBackOff: lê eventos, logs do container anterior e limites de recurso, e aponta a causa mais provável.',
    tags: ['kubernetes', 'debug', 'sre'],
    revision: 5,
    sizeKb: 47,
    hasBundle: true,
    score: 0.78,
  },
  {
    skillId: 'terraform-planner',
    displayName: 'Terraform Planner',
    description:
      'Lê um plan e explica em português o que muda, o que é destrutivo e o que exige janela de manutenção.',
    tags: ['infra', 'terraform', 'review'],
    revision: 1,
    sizeKb: 31,
    hasBundle: false,
    score: 0.74,
  },
  {
    skillId: 'pg-migration-guard',
    displayName: 'Postgres Migration Guard',
    description:
      'Revisa migrations antes do deploy: detecta lock exclusivo em tabela grande, coluna NOT NULL sem default e índice sem CONCURRENTLY.',
    tags: ['database', 'review', 'postgres'],
    revision: 3,
    sizeKb: 28,
    hasBundle: false,
    score: 0.69,
  },
  {
    skillId: 'incident-postmortem',
    displayName: 'Incident Postmortem',
    description:
      'Transforma a timeline de um incidente em postmortem blameless, com linha do tempo, impacto medido e itens de ação com dono.',
    tags: ['sre', 'writing', 'process'],
    revision: 4,
    sizeKb: 19,
    hasBundle: false,
    score: 0.66,
  },
  {
    skillId: 'api-contract-reviewer',
    displayName: 'API Contract Reviewer',
    description:
      'Compara duas versões de um OpenAPI e classifica cada mudança como compatível, arriscada ou quebra de contrato.',
    tags: ['api', 'review', 'openapi'],
    revision: 2,
    sizeKb: 54,
    hasBundle: true,
    score: 0.63,
  },
  {
    skillId: 'cost-explorer',
    displayName: 'Cost Explorer',
    description:
      'Explica o pico da fatura do mês: quebra por serviço, compara com o mês anterior e aponta os três maiores ofensores.',
    tags: ['finops', 'cloud', 'analysis'],
    revision: 1,
    sizeKb: 63,
    hasBundle: true,
    score: 0.58,
  },
  {
    skillId: 'log-forensics',
    displayName: 'Log Forensics',
    description:
      'Segue um trace_id por todos os serviços e monta a sequência de eventos que levou ao erro, incluindo os saltos assíncronos.',
    tags: ['observability', 'debug', 'sre'],
    revision: 6,
    sizeKb: 41,
    hasBundle: true,
    score: 0.55,
  },
  {
    skillId: 'secret-rotation',
    displayName: 'Secret Rotation',
    description:
      'Conduz a rotação de uma credencial ponta a ponta: gera, publica no cofre, faz rollout e só então revoga a antiga.',
    tags: ['security', 'ops', 'runbook'],
    revision: 2,
    sizeKb: 22,
    hasBundle: false,
    score: 0.51,
  },
  {
    skillId: 'canary-analyst',
    displayName: 'Canary Analyst',
    description:
      'Compara métricas do canário contra a baseline e recomenda promover, aguardar ou reverter, com o motivo explícito.',
    tags: ['deploy', 'observability', 'sre'],
    revision: 3,
    sizeKb: 37,
    hasBundle: true,
    score: 0.47,
  },
  {
    skillId: 'dockerfile-optimizer',
    displayName: 'Dockerfile Optimizer',
    description:
      'Reescreve um Dockerfile para cache em camadas e multi-stage, mostrando o ganho estimado de tempo de build e tamanho.',
    tags: ['build', 'docker', 'performance'],
    revision: 1,
    sizeKb: 16,
    hasBundle: false,
    score: 0.42,
  },
  {
    skillId: 'rag-eval-designer',
    displayName: 'RAG Eval Designer',
    description:
      'Monta um conjunto de avaliação para um pipeline RAG: escolhe perguntas, define o gabarito e calcula recall e precisão.',
    tags: ['ai', 'eval', 'rag'],
    revision: 2,
    sizeKb: 58,
    hasBundle: true,
    score: 0.38,
  },
];

/* ─────────────────────────── detalhe de uma skill ─────────────────────────── */

export interface Revision {
  readonly id: number;
  readonly createdAt: string;
  readonly sizeKb: number;
  readonly current: boolean;
  readonly note: string;
}

export interface PayloadEntry {
  readonly path: string;
  readonly bytes: number;
}

export interface Delivery {
  readonly eventType: 'skill.created' | 'skill.updated' | 'skill.deleted';
  readonly endpoint: string;
  readonly status: number | null;
  readonly attempt: number;
  readonly at: string;
}

/** Datas fixas — `new Date()` tornaria a tela diferente a cada abertura. */
const DAY = 86_400_000;
const ANCHOR = Date.parse('2026-07-28T14:20:00Z');
const daysAgo = (n: number): string => new Date(ANCHOR - n * DAY).toISOString();

/**
 * Revisões derivadas do número da revisão corrente. Cada `publish` cria uma nova
 * revisão e a anterior permanece recuperável — é a regra de M1, não enfeite.
 */
export function revisionsOf(skill: CatalogSkill): Revision[] {
  const notes = [
    'primeira publicação',
    'descrição reescrita para gatilho mais preciso',
    'scripts/ adicionado',
    'correção de limite de payload',
    'guardrails ampliados',
    'exemplos revisados',
  ];
  return Array.from({ length: skill.revision }, (_, i) => {
    const id = skill.revision - i;
    return {
      id,
      createdAt: daysAgo(i * 9 + 2),
      sizeKb: Math.max(8, skill.sizeKb - i * 4),
      current: i === 0,
      note: notes[(id - 1) % notes.length]!,
    };
  });
}

/** Conteúdo do `SKILL.md` no formato Theokit — os campos que M1 valida na fronteira. */
export function skillMarkdown(skill: CatalogSkill): string {
  return [
    '---',
    `name: ${skill.skillId}`,
    `description: ${skill.description}`,
    `version: ${skill.revision}.0.0`,
    `category: ${skill.tags[0] ?? 'general'}`,
    'allowed-tools: [read, bash]',
    '---',
    '',
    '## Quando usar',
    '',
    `Use esta skill quando ${skill.description[0]!.toLowerCase()}${skill.description.slice(1)}`,
    '',
    '## Instruções',
    '',
    '1. Confirme o alvo com quem pediu antes de qualquer escrita.',
    '2. Execute o passo e mostre o resultado bruto.',
    '3. Se algo divergir do esperado, pare e reporte — não improvise.',
    '',
    '## Guardrails',
    '',
    '- Nunca aplique mudança em produção sem confirmação explícita.',
    '- Nunca exponha credenciais na saída.',
  ].join('\n');
}

export function payloadOf(skill: CatalogSkill): PayloadEntry[] {
  const base: PayloadEntry[] = [{ path: 'SKILL.md', bytes: 2_400 }];
  if (!skill.hasBundle) return base;
  return [
    ...base,
    { path: 'scripts/run.py', bytes: Math.round(skill.sizeKb * 620) },
    { path: 'references/cheatsheet.md', bytes: 8_100 },
  ];
}

export function deliveriesOf(skill: CatalogSkill): Delivery[] {
  const endpoint = 'https://ops.internal/hooks/skills';
  const out: Delivery[] = [
    { eventType: 'skill.created', endpoint, status: 200, attempt: 1, at: daysAgo(skill.revision * 9) },
  ];
  if (skill.revision > 1) {
    out.unshift(
      { eventType: 'skill.updated', endpoint, status: 503, attempt: 1, at: daysAgo(2) },
      { eventType: 'skill.updated', endpoint, status: 200, attempt: 3, at: daysAgo(2) },
    );
  }
  return out;
}

/** O que a tela de DETALHE mostra e o backend ainda não entrega. */
export const DETAIL_GAPS: readonly string[] = [
  'Autoria — quem publicou cada revisão — não é registrada hoje: não há principal autenticado (M6).',
  'Baixar o payload de uma revisão existe via `GET /v1/skills/{id}/revisions/{revId}`, mas não há URL assinada nem controle de quem pode baixar (M6).',
  'A entrega de webhook mostrada é por endpoint global; assinatura por skill/projeto está no DoD de M2 e ainda não é filtrável por skill na API.',
];

/** Toda tag do catálogo, com quantas skills a usam — como os filtros da referência. */
export function tagCounts(skills: readonly CatalogSkill[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of skills) {
    for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * O que esta tela mostra e o backend NÃO entrega hoje. Renderizado na própria
 * tela: um protótipo que exibe campo inexistente sem avisar vira requisito
 * fantasma na cabeça de quem aprova.
 */
export const CATALOG_GAPS: readonly string[] = [
  '`tags` não existem no modelo de skill — hoje só há skillId, displayName, description e revisão. Adicionar é mudança de contrato (M1).',
  'Filtrar por tag exige um endpoint de facetas ou filtro em `GET /v1/skills`; hoje a listagem é paginada e sem filtro.',
  'Contador de uso / rating (o polegar da galeria de referência) não existe — é exatamente a decisão aberta #2 sobre o ranking ouvir uso.',
  '`score` só volta no `GET /v1/skills:retrieve` com query. Na listagem sem busca ele não existe — aqui aparece como ilustração.',
];
