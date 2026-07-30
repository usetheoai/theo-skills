/**
 * Regras da publicação — espelham o código, não a imaginação.
 *
 * Fontes (conferidas em 2026-07-30):
 *   - packages/core/src/domain/limits.ts        → limites de frontmatter e zip
 *   - packages/core/src/domain/skill-id.ts      → regex, comprimento, prefixo reservado
 *   - packages/core/src/domain/payload-validator.ts → os 11 PayloadErrorCode
 *
 * DIVERGÊNCIA A VIGIAR: as regras estão reimplementadas aqui porque o protótipo é
 * isolado do monorepo (instala com --ignore-workspace). Num app real isto viria de
 * `@usetheo/skills` — uma regra, um dono. Se `skill-id.ts` mudar, isto silencia.
 */

export const LIMITS = {
  /** skill-id.ts: MAX_LENGTH */
  maxSkillIdLength: 63,
  /** skill-id.ts: RESERVED_PREFIX */
  reservedPrefix: 'gcp-',
  /** limits.ts: MAX_NAME_LENGTH */
  maxNameLength: 64,
  /** limits.ts: MAX_DESCRIPTION_LENGTH */
  maxDescriptionLength: 1024,
  /** app.ts: DEFAULT_MAX_BODY_BYTES (~25 MB de zip depois do envelope base64) */
  maxUploadBytes: 35 * 1024 * 1024,
  maxUploadMb: 25,
} as const;

/** Espelha `assertValidSkillId` (skill-id.ts) — mesma ordem de checagem. */
const SKILL_ID_RE = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

export function describeSkillId(value: string): { valid: boolean; reason?: string } {
  if (value === '') return { valid: false, reason: 'obrigatório' };
  if (value.length > LIMITS.maxSkillIdLength) {
    return { valid: false, reason: `comprimento deve ser 1..${LIMITS.maxSkillIdLength} (tem ${value.length})` };
  }
  if (value.startsWith(LIMITS.reservedPrefix)) {
    return { valid: false, reason: `prefixo "${LIMITS.reservedPrefix}" é reservado` };
  }
  if (!SKILL_ID_RE.test(value)) {
    return {
      valid: false,
      reason: 'apenas minúsculas, números e hífens; começa com letra e termina com letra ou número',
    };
  }
  return { valid: true };
}

export interface CheckResult {
  /** PayloadErrorCode real, ou `frontmatter` para a checagem do SKILL.md. */
  readonly code: string;
  readonly label: string;
  readonly detail: string;
  /** `skip` = guard não alcançável nesta origem; `warn` = só o servidor decide. */
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
}

/** Esqueleto sugerido do corpo — a estrutura que o formato Theokit espera. */
export const BODY_SKELETON = `## Quando usar

Descreva o gatilho: em que situação o agente deve alcançar esta skill.

## Instruções

1. Primeiro passo concreto.
2. Segundo passo.
3. O que fazer quando o resultado divergir do esperado.

## Guardrails

- O que o agente NÃO deve fazer.
- Que confirmação pedir antes de uma ação irreversível.`;

/** Monta o SKILL.md a partir do formulário — é exatamente o que seria empacotado. */
export function composeSkillMd(input: {
  name: string;
  description: string;
  version: string;
  category: string;
  allowedTools: string[];
  body: string;
}): string {
  const front = [
    '---',
    `name: ${input.name || '<name>'}`,
    `description: ${input.description || '<description>'}`,
    `version: ${input.version || '1.0.0'}`,
    ...(input.category ? [`category: ${input.category}`] : []),
    ...(input.allowedTools.length > 0 ? [`allowed-tools: [${input.allowedTools.join(', ')}]`] : []),
    '---',
    '',
  ].join('\n');
  return front + (input.body.trim() === '' ? BODY_SKELETON : input.body);
}

/** De onde veio o pacote: enviado pronto, ou montado pela própria UI. */
export type PublishSource = 'upload' | 'editor';

/**
 * Checks do pacote MONTADO PELO EDITOR. Vários guards deixam de ser alcançáveis
 * quando o zip é gerado pela UI a partir de um formulário — dizer "passou" onde na
 * verdade "não se aplica" seria teatro de validação.
 *
 * O servidor reaplica TODOS eles de qualquer forma: a UI é conveniência, a
 * fronteira HTTP é a autoridade.
 */
export const EDITOR_CHECKS: readonly CheckResult[] = [
  {
    code: 'invalid_zip',
    label: 'Pacote montado no navegador',
    detail: '1 entrada · SKILL.md gerado a partir do formulário',
    status: 'pass',
  },
  {
    code: 'missing_skill_md',
    label: 'SKILL.md presente na raiz',
    detail: 'gerado · frontmatter com name, description e version preenchidos',
    status: 'pass',
  },
  {
    code: 'frontmatter',
    label: 'Campos do frontmatter dentro dos limites',
    detail: `name ≤ ${LIMITS.maxNameLength} · description ≤ ${LIMITS.maxDescriptionLength}`,
    status: 'pass',
  },
  { code: 'too_many_entries', label: 'Quantidade de entradas', detail: '1 de 10.000', status: 'pass' },
  { code: 'total_too_large', label: 'Tamanho total', detail: '2,4 KB de 500 MB', status: 'pass' },
  {
    code: 'path_traversal',
    label: 'Caminhos fora da raiz',
    detail: 'não alcançável: a UI escreve um único SKILL.md na raiz',
    status: 'skip',
  },
  {
    code: 'symlink',
    label: 'Symlinks',
    detail: 'não alcançável: o navegador não gera link simbólico',
    status: 'skip',
  },
  {
    code: 'duplicate_entry',
    label: 'Nomes duplicados',
    detail: 'não alcançável com uma entrada só',
    status: 'skip',
  },
  {
    code: 'secret_detected',
    label: 'Varredura de segredos',
    detail: 'roda no servidor sobre o texto enviado — o resultado só existe depois do POST',
    status: 'warn',
  },
];

/**
 * Resultado ilustrativo para o pacote de exemplo enviado. Os 11 códigos são os
 * reais de `PayloadErrorCode`; o veredito de cada um aqui é encenação do protótipo.
 */
export const CHECKS: readonly CheckResult[] = [
  { code: 'invalid_zip', label: 'Arquivo é um zip legível', detail: '14 entradas lidas', status: 'pass' },
  {
    code: 'missing_skill_md',
    label: 'SKILL.md presente na raiz',
    detail: 'encontrado · frontmatter Theokit válido (name, description, version)',
    status: 'pass',
  },
  {
    code: 'too_many_entries',
    label: 'Quantidade de entradas dentro do limite',
    detail: '14 de 10.000',
    status: 'pass',
  },
  {
    code: 'total_too_large',
    label: 'Tamanho total descompactado dentro do limite',
    detail: '82 KB de 500 MB',
    status: 'pass',
  },
  {
    code: 'file_too_large',
    label: 'Nenhum arquivo isolado acima do limite',
    detail: 'maior: scripts/run.py com 51 KB (teto 10 MB)',
    status: 'pass',
  },
  {
    code: 'compression_ratio',
    label: 'Razão de compressão sob o teto anti-zip-bomb',
    detail: '3.2:1 (teto 100:1)',
    status: 'pass',
  },
  { code: 'too_deep', label: 'Profundidade de pastas aceitável', detail: '3 níveis (teto 8)', status: 'pass' },
  {
    code: 'path_traversal',
    label: 'Nenhum caminho escapando da raiz',
    detail: 'nenhuma entrada com ".."',
    status: 'pass',
  },
  { code: 'symlink', label: 'Nenhum symlink', detail: 'nenhum link simbólico no pacote', status: 'pass' },
  {
    code: 'duplicate_entry',
    label: 'Nenhum nome duplicado',
    detail: '14 caminhos distintos',
    status: 'pass',
  },
  {
    code: 'secret_detected',
    label: 'Varredura de segredos',
    detail: 'nenhum segredo reconhecido pelas regras do secretlint',
    status: 'pass',
  },
];
