/**
 * Ciclo de vida da skill — o eixo EDITORIAL, deliberadamente separado de outros dois.
 *
 * O registro tem três dimensões que respondem perguntas diferentes e não devem ser fundidas
 * (ADR D1 do plano `m32-skill-lifecycle`):
 *
 *   - `lifecycle` (aqui)   — o que a skill É no ciclo de publicação: `active` · `draft` · `deprecated`
 *   - habilitação          — liga/desliga operacional, reversível, sem juízo editorial
 *   - `skills.state`       — exclusão (`ACTIVE`/`DELETED`), soft-delete que RESERVA o identificador
 *
 * Fundi-las custaria a capacidade de desligar temporariamente algo que não está descontinuado,
 * e faria `DELETED` (irreversível, com reserva) parecer o mesmo eixo de `deprecated` (reversível).
 *
 * O módulo é domínio puro: nenhum import de infraestrutura, de HTTP ou de Zod — a direção
 * permitida por `rules/architecture.md` é infra→domínio, nunca o contrário.
 */

/** O vocabulário fechado. Única fonte — o schema e o contrato derivam daqui, não redeclaram. */
export const SKILL_LIFECYCLES = ['active', 'draft', 'deprecated'] as const;

export type SkillLifecycle = (typeof SKILL_LIFECYCLES)[number];

/**
 * Erro tipado para estágio inválido. Carrega o valor ofensor e um `code` estável para a
 * fronteira falhar alto e claro (Unbreakable Rule 8) — o consumidor decide pelo `code`,
 * o humano lê a `message`.
 */
export class InvalidLifecycleError extends Error {
  readonly code = 'INVALID_LIFECYCLE';
  readonly value: string;

  constructor(value: string) {
    super(`Invalid skill lifecycle "${value}": expected one of ${SKILL_LIFECYCLES.join(', ')}`);
    this.name = 'InvalidLifecycleError';
    this.value = value;
  }
}

/**
 * Valida um estágio na fronteira de confiança. Normaliza caixa e espaços antes de comparar:
 * a entrada vem de HTTP e de CLI, e transformar diferença de caixa em 4xx não protege ninguém.
 *
 * Devolve o valor canônico; lança `InvalidLifecycleError` caso contrário.
 */
export function parseLifecycle(value: string): SkillLifecycle {
  const normalized = value.trim().toLowerCase();
  if (!(SKILL_LIFECYCLES as readonly string[]).includes(normalized)) {
    // Reporta o valor COMO VEIO, não o normalizado — quem depura precisa ver o que enviou.
    throw new InvalidLifecycleError(value);
  }
  return normalized as SkillLifecycle;
}

/** Variante que não lança — para quando a ausência de um estágio válido não é excepcional. */
export function isValidLifecycle(value: string): boolean {
  try {
    parseLifecycle(value);
    return true;
  } catch {
    return false;
  }
}

/** O que uma consulta de DESCOBERTA deve considerar visível. Traduzido para SQL pelo store. */
export interface LifecycleVisibility {
  readonly stages: SkillLifecycle[];
  readonly requireEnabled: boolean;
}

/** Opt-in por eixo. Ausente = restrito, que é o default seguro para descoberta. */
export interface LifecycleVisibilityOptions {
  readonly includeDraft?: boolean;
  readonly includeDeprecated?: boolean;
  readonly includeDisabled?: boolean;
}

/**
 * Constrói a especificação de visibilidade da DESCOBERTA — e apenas dela.
 *
 * A resolução por identificador NUNCA consulta esta função: é essa assimetria que faz a
 * deprecação não quebrar quem já referencia a skill (ADR D2). Se um dia o caminho de leitura
 * passar a chamar `buildLifecycleFilter`, o teste de regressão do M32 reprova — e deve.
 *
 * Os dois eixos COMPÕEM, não se anulam: pedir os desabilitados não devolve rascunhos junto.
 */
export function buildLifecycleFilter(opts: LifecycleVisibilityOptions = {}): LifecycleVisibility {
  const stages: SkillLifecycle[] = ['active'];
  if (opts.includeDraft) stages.push('draft');
  if (opts.includeDeprecated) stages.push('deprecated');
  return { stages, requireEnabled: !opts.includeDisabled };
}
