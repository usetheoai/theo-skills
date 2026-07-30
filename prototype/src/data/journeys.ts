/**
 * Dados do protótipo de alinhamento.
 *
 * REGRA DESTE ARQUIVO: nada aqui é inventado. Rotas, subcomandos de CLI, enums e
 * estados vêm do código real (conferido em 2026-07-30):
 *   - 9 rotas: packages/api/src/server/handlers/*.ts
 *   - 7 subcomandos: packages/cli/src/args.ts
 *   - OperationState / WebhookEventType / RetrieveStrategy: packages/core/src/contract/index.ts
 * O que ainda NÃO existe está marcado `missing` e o texto usa condicional —
 * um protótipo que promete o que não foi construído é pior que nenhum protótipo.
 */

/** `built` = existe no código hoje. `partial` = parte existe. `missing` = a construir. */
export type Status = 'built' | 'partial' | 'missing';

export type Line =
  | { kind: 'cmd'; text: string }
  | { kind: 'out'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'fail'; text: string }
  | { kind: 'muted'; text: string }
  | { kind: 'json'; text: string };

export interface Step {
  readonly n: number;
  readonly title: string;
  readonly actor: string;
  readonly status: Status;
  readonly milestones: readonly string[];
  /** O que o passo prova, em uma frase. */
  readonly proves: string;
  readonly screenLabel: string;
  readonly screen: readonly Line[];
  /** Perguntas honestas que este passo ainda não responde. */
  readonly gaps?: readonly string[];
}

export interface Journey {
  readonly id: string;
  readonly persona: string;
  readonly role: string;
  readonly need: string;
  readonly status: Status;
  readonly steps: readonly Step[];
}

export const MILESTONES: readonly { id: string; name: string; done: boolean }[] = [
  { id: 'M0', name: 'Walking skeleton', done: true },
  { id: 'M1', name: 'Modelo de skill + validação', done: true },
  { id: 'M2', name: 'LRO + governança + webhook', done: true },
  { id: 'M3', name: 'Embeddings + pgvector', done: true },
  { id: 'M4', name: 'Busca híbrida (retrieve)', done: true },
  { id: 'M5', name: 'CLI de dev local', done: true },
  { id: 'M6', name: 'RBAC granular por skill', done: false },
  { id: 'M7', name: 'Integração Theokit + dogfood', done: false },
  { id: 'M8', name: 'Hardening + observabilidade', done: false },
  { id: 'M9', name: 'Gaps de engenharia (ACE)', done: true },
];

export const JOURNEYS: readonly Journey[] = [
  {
    id: 'author',
    persona: 'Skill Author',
    role: 'engenheiro que escreve a skill',
    need: 'Publicar e versionar uma skill sem descobrir os erros no servidor.',
    status: 'built',
    steps: [
      {
        n: 1,
        title: 'Configurar o registry uma vez',
        actor: 'CLI',
        status: 'built',
        milestones: ['M9'],
        proves: 'A config local existe, então publish não repete flags a cada chamada.',
        screenLabel: 'terminal',
        screen: [
          { kind: 'cmd', text: 'theoskill init' },
          { kind: 'out', text: 'registry url  › http://localhost:8080' },
          { kind: 'out', text: 'auth token    › ****************' },
          { kind: 'ok', text: 'escrito em .theoskill/config.json' },
        ],
      },
      {
        n: 2,
        title: 'Validar localmente antes de subir',
        actor: 'CLI · mesma regra do servidor',
        status: 'built',
        milestones: ['M1', 'M5'],
        proves:
          'O checker vive no core e é consumido pela CLI e pela fronteira HTTP — uma regra, dois consumidores.',
        screenLabel: 'terminal',
        screen: [
          { kind: 'cmd', text: 'theoskill validate ./cloud-resource-manager' },
          { kind: 'ok', text: '✓ SKILL.md — frontmatter Theokit válido' },
          { kind: 'ok', text: '✓ payload — 14 itens, 82 KB, profundidade 3' },
          { kind: 'fail', text: '✗ scripts/deploy.sh:12 — secret detectado (aws-access-key)' },
          { kind: 'muted', text: '' },
          { kind: 'fail', text: '1 skill falhou. exit 1' },
        ],
      },
      {
        n: 3,
        title: 'Publicar — a resposta é uma operação, não a skill',
        actor: 'CLI → POST /v1/skills',
        status: 'built',
        milestones: ['M0', 'M1', 'M2'],
        proves: 'Mutação é assíncrona por contrato: o cliente recebe algo rastreável.',
        screenLabel: 'POST /v1/skills',
        screen: [
          { kind: 'cmd', text: 'theoskill publish ./cloud-resource-manager' },
          { kind: 'out', text: 'empacotando… 82 KB · base64' },
          { kind: 'json', text: '{ "operation": { "id": "op_7fk2", "done": false } }' },
          { kind: 'ok', text: 'enfileirado (pg-boss)' },
        ],
      },
      {
        n: 4,
        title: 'Acompanhar até ACTIVE',
        actor: 'CLI → GET /v1/operations/:id',
        status: 'built',
        milestones: ['M2', 'M9'],
        proves:
          'Estados explícitos + trace_id propagado do HTTP ao job: uma ingestão é rastreável ponta a ponta.',
        screenLabel: 'GET /v1/operations/op_7fk2',
        screen: [
          { kind: 'cmd', text: 'theoskill status op_7fk2' },
          { kind: 'muted', text: 'CREATING · trace 4f9a…c1' },
          { kind: 'muted', text: 'CREATING · validando payload' },
          { kind: 'muted', text: 'CREATING · gerando embedding' },
          { kind: 'ok', text: 'ACTIVE · revisão 1 · 1.9s' },
        ],
      },
      {
        n: 5,
        title: 'Republicar cria revisão — não sobrescreve',
        actor: 'CLI → PATCH + GET /revisions',
        status: 'built',
        milestones: ['M1'],
        proves: 'Histórico é recuperável: revisão é imutável e o skillId é reservado até após o delete.',
        screenLabel: 'GET /v1/skills/:id/revisions',
        screen: [
          { kind: 'cmd', text: 'theoskill revisions cloud-resource-manager' },
          { kind: 'out', text: 'rev 2  2026-07-30  ativa   82 KB' },
          { kind: 'out', text: 'rev 1  2026-07-12  imutável 79 KB' },
        ],
        gaps: [
          'Nada impede hoje que dois autores publiquem na mesma skill — permissão por skill é M6.',
        ],
      },
    ],
  },
  {
    id: 'builder',
    persona: 'Agent Builder',
    role: 'quem monta o agente',
    need: 'Achar a skill certa pela intenção, não pelo nome exato que alguém escolheu.',
    status: 'partial',
    steps: [
      {
        n: 1,
        title: 'Perguntar em linguagem natural',
        actor: 'GET /v1/skills:retrieve',
        status: 'built',
        milestones: ['M3', 'M4'],
        proves: 'Descoberta por intenção: quem busca não precisa saber o vocabulário do autor.',
        screenLabel: 'GET /v1/skills:retrieve?query=…&topK=5',
        screen: [
          { kind: 'cmd', text: 'query: "preciso mexer em recursos de nuvem do projeto"' },
          { kind: 'muted', text: 'strategy: hybrid  ·  keyword (FTS) + vetor (pgvector/HNSW)' },
        ],
      },
      {
        n: 2,
        title: 'Ver o score, não só a ordem',
        actor: 'resposta ranqueada',
        status: 'built',
        milestones: ['M4'],
        proves:
          'Score explícito por resultado — o ranking é auditável, diferente de uma caixa-preta que só devolve a ordem.',
        screenLabel: 'retrievedSkills',
        screen: [
          { kind: 'ok', text: '0.91  cloud-resource-manager   Cria e gerencia recursos de nuvem' },
          { kind: 'out', text: '0.74  terraform-planner       Planeja mudanças de infraestrutura' },
          { kind: 'out', text: '0.68  k8s-triage              Diagnostica pods em falha' },
          { kind: 'muted', text: '0.41  chart-builder           Gera gráficos de dados tabulares' },
          { kind: 'muted', text: '' },
          { kind: 'muted', text: 'p95 alvo < 200ms · Recall@5 alvo ≥ 0.85' },
        ],
        gaps: [
          'O ranking usa só sinal textual. Popularidade/uso não entra — ver decisão aberta #2.',
        ],
      },
      {
        n: 3,
        title: 'Abrir a skill e ler o que ela promete',
        actor: 'GET /v1/skills/:id',
        status: 'built',
        milestones: ['M1'],
        proves: 'Metadados + revisão corrente num GET síncrono.',
        screenLabel: 'GET /v1/skills/cloud-resource-manager',
        screen: [
          { kind: 'json', text: '{' },
          { kind: 'json', text: '  "skillId": "cloud-resource-manager",' },
          { kind: 'json', text: '  "displayName": "Cloud Resource Manager",' },
          { kind: 'json', text: '  "description": "Cria e gerencia recursos de nuvem…",' },
          { kind: 'json', text: '  "revision": 2, "state": "ACTIVE"' },
          { kind: 'json', text: '}' },
        ],
        gaps: [
          'Um só campo `description` serve humano e modelo ao mesmo tempo — ver decisão aberta #1.',
        ],
      },
      {
        n: 4,
        title: 'Anexar a skill ao agente',
        actor: 'Theokit',
        status: 'missing',
        milestones: ['M7'],
        proves: 'ISTO AINDA NÃO EXISTE. É o passo que fecha o ciclo do produto.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'muted', text: '@Skills(["cloud-resource-manager"])' },
          { kind: 'muted', text: '' },
          { kind: 'fail', text: 'não há provider remoto que resolva isso hoje' },
          { kind: 'muted', text: 'hoje o Theokit só lê .theokit/skills/ no disco' },
        ],
        gaps: [
          'Formato de retorno tem de casar com o Skill { name, description, source, version } do Theokit.',
          'Contrato precisa ser alinhado com o time do Theokit antes de implementar.',
        ],
      },
    ],
  },
  {
    id: 'runtime',
    persona: 'Runtime do agente',
    role: 'o processo que executa o agente',
    need: 'Resolver a revisão correta em runtime — e não morrer quando o registry cair.',
    status: 'missing',
    steps: [
      {
        n: 1,
        title: 'Agente declara as skills que quer',
        actor: 'Theokit',
        status: 'missing',
        milestones: ['M7'],
        proves: 'Ponto de entrada da jornada: hoje resolve só localmente.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'muted', text: 'const agent = Agent.create({' },
          { kind: 'muted', text: '  skills: ["cloud-resource-manager", "k8s-triage"],' },
          { kind: 'muted', text: '})' },
        ],
      },
      {
        n: 2,
        title: 'RemoteSkillsManager busca no registry',
        actor: 'Theokit → HTTP',
        status: 'missing',
        milestones: ['M7'],
        proves: 'A peça central que falta: list + retrieve semântico por HTTP.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'muted', text: 'GET /v1/skills            → catálogo' },
          { kind: 'muted', text: 'GET /v1/skills:retrieve   → por intenção' },
          { kind: 'muted', text: '' },
          { kind: 'fail', text: 'nenhuma das duas tem consumidor Theokit hoje' },
        ],
      },
      {
        n: 3,
        title: 'Cache local da revisão resolvida',
        actor: 'Theokit',
        status: 'missing',
        milestones: ['M7'],
        proves: 'Sem cache, cada execução do agente paga a latência de rede.',
        screenLabel: 'a construir',
        screen: [{ kind: 'muted', text: 'cache hit → rev 2 (sem chamada de rede)' }],
      },
      {
        n: 4,
        title: 'Registry cai — o agente continua',
        actor: 'fallback',
        status: 'missing',
        milestones: ['M7'],
        proves:
          'O caminho de degradação é o que decide se isto é usável em produção. Precisa de teste próprio.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'fail', text: 'registry timeout (5s)' },
          { kind: 'muted', text: 'fallback → .theokit/skills/ no disco' },
          { kind: 'muted', text: 'agente segue com a última revisão conhecida' },
        ],
        gaps: ['Fallback mal feito deixa o agente sem skill nenhuma — testar o caminho triste.'],
      },
      {
        n: 5,
        title: 'Dogfood real — o critério de "shipped"',
        actor: 'nós mesmos',
        status: 'missing',
        milestones: ['M7'],
        proves:
          'Sem um agente interno usando isto de verdade, "production-ready" é alegação sem evidência.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'muted', text: 'um agente Theokit interno servido pelo registry' },
          { kind: 'muted', text: 'Recall@5 ≥ 0.85 e p95 < 200ms confirmados NESSE uso' },
          { kind: 'muted', text: '' },
          { kind: 'fail', text: 'nenhuma evidência de dogfood registrada' },
        ],
      },
    ],
  },
  {
    id: 'operator',
    persona: 'Operador / SRE',
    role: 'quem governa o catálogo',
    need: 'Auditar o que entrou, quem mexeu e por que uma operação falhou.',
    status: 'partial',
    steps: [
      {
        n: 1,
        title: 'Listar o catálogo',
        actor: 'GET /v1/skills',
        status: 'built',
        milestones: ['M1'],
        proves: 'Listagem paginada.',
        screenLabel: 'GET /v1/skills?pageSize=20',
        screen: [
          { kind: 'out', text: 'cloud-resource-manager  ACTIVE   rev 2' },
          { kind: 'out', text: 'k8s-triage              ACTIVE   rev 1' },
          { kind: 'muted', text: 'legacy-deployer         DELETING op_9x1' },
        ],
      },
      {
        n: 2,
        title: 'Inspecionar uma operação que falhou',
        actor: 'GET /v1/operations/:id',
        status: 'built',
        milestones: ['M2'],
        proves:
          'Erro tipado, sem retry em violação de regra de negócio — só em falha transitória.',
        screenLabel: 'GET /v1/operations/op_3ba8',
        screen: [
          { kind: 'fail', text: 'FAILED · payload_invalid' },
          { kind: 'out', text: 'SKILL.md ausente na raiz do zip' },
          { kind: 'muted', text: 'retries: 0 (regra de negócio — não reprocessa)' },
        ],
      },
      {
        n: 3,
        title: 'Webhook entregou? reentregar',
        actor: '/v1/webhookEndpoints',
        status: 'built',
        milestones: ['M2', 'M9'],
        proves:
          'Entrega at-least-once com assinatura, backoff exponencial com jitter e guarda de SSRF na URL.',
        screenLabel: 'webhookDeliveries',
        screen: [
          { kind: 'ok', text: 'skill.created  → https://ops.internal/hook  200  1ª tentativa' },
          { kind: 'fail', text: 'skill.updated  → https://ops.internal/hook  503' },
          { kind: 'muted', text: '  retry em 2s · 4s · 8s (+jitter)' },
          { kind: 'ok', text: 'skill.updated  → entregue na 3ª' },
        ],
      },
      {
        n: 4,
        title: 'Seguir uma ingestão ponta a ponta',
        actor: 'trace_id',
        status: 'partial',
        milestones: ['M9', 'M8'],
        proves:
          'O trace_id já atravessa HTTP → operation → job → webhook (M9). O que falta é OTel de verdade: spans, métricas por skill, error budget (M8).',
        screenLabel: 'trace 4f9a…c1',
        screen: [
          { kind: 'ok', text: 'http  POST /v1/skills        trace 4f9a…c1' },
          { kind: 'ok', text: 'op    op_7fk2 CREATING       trace 4f9a…c1' },
          { kind: 'ok', text: 'job   validate+embed         trace 4f9a…c1' },
          { kind: 'ok', text: 'hook  skill.created 200      trace 4f9a…c1' },
          { kind: 'muted', text: '' },
          { kind: 'fail', text: 'sem spans OTel · sem métrica por skill · sem SLO com alarme' },
        ],
      },
      {
        n: 5,
        title: 'Quem pode publicar nesta skill?',
        actor: 'RBAC',
        status: 'missing',
        milestones: ['M6'],
        proves:
          'ISTO NÃO EXISTE. Hoje quem alcança a API alcança todas as skills — não há permissão por skill nem audit log por principal.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'muted', text: 'ler · escrever · publicar · deletar — por skill' },
          { kind: 'muted', text: '403 sem vazar existência da skill' },
          { kind: 'muted', text: '' },
          { kind: 'fail', text: 'nenhum middleware de permissão hoje' },
        ],
        gaps: ['Risco registrado no roadmap: RBAC complexo demais para o V1. Começar mínimo.'],
      },
      {
        n: 6,
        title: 'Proteger o serviço de abuso',
        actor: 'rate limit + SLO',
        status: 'missing',
        milestones: ['M8'],
        proves: 'Limites definidos por medição, não por chute.',
        screenLabel: 'a construir',
        screen: [
          { kind: 'muted', text: 'rate limit por principal' },
          { kind: 'muted', text: 'SLO documentado: retrieve p95 < 200ms + alarme de regressão' },
        ],
      },
    ],
  },
];

/** Decisões que o protótipo existe para provocar — nenhuma foi tomada. */
export const DECISIONS: readonly {
  n: number;
  title: string;
  body: string;
  source: string;
  affects: readonly string[];
}[] = [
  {
    n: 1,
    title: 'Uma descrição ou duas?',
    body:
      'Hoje temos um único `description` e ele entra no embedding junto com displayName e o corpo do SKILL.md. O peer da Microsoft separa deliberadamente: a do SKILL.md é gatilho lido pelo modelo, a do metadata.json é vitrine lida por gente. Se as duas viram um vetor só, o sinal de gatilho é diluído por texto de marketing.',
    source: 'microsoft/cat-agent-skills · docs/authoring-skills.md § 2',
    affects: ['M1', 'M3', 'M4'],
  },
  {
    n: 2,
    title: 'O ranking deveria ouvir uso?',
    body:
      'O retrieve combina keyword + vetor e nada mais. Popularidade, rating ou taxa de sucesso de execução são sinais fora do texto que poderiam entrar no rerank. Custo: passa a existir estado de feedback para manter.',
    source: 'microsoft/cat-agent-skills · docs/ratings.md · e o loop do ACE',
    affects: ['M4'],
  },
  {
    n: 3,
    title: 'De onde vem o eval set do Recall@5?',
    body:
      'A meta de 0.85 precisa de um conjunto de avaliação com skills reais. Há 74 skills MIT no peer clonado — mas copiar bytes da zona read-only cria material derivado e exige ADR + atribuição. Alternativa: gerar corpus próprio, mais pobre porém sem dúvida jurídica.',
    source: 'reference-provenance.md · licença MIT do peer',
    affects: ['M4'],
  },
  {
    n: 4,
    title: 'Qual é o RBAC mínimo do V1?',
    body:
      'Quatro verbos por skill (ler/escrever/publicar/deletar) já é um modelo. O risco anotado no roadmap é over-engineering. A pergunta é o que o V1 realmente precisa: dono por skill, ou papéis por projeto?',
    source: 'ROADMAP.md § M6 · top risk 1',
    affects: ['M6'],
  },
];
