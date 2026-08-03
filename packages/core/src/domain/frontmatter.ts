import { parse as parseYaml } from 'yaml';

import { MAX_CATEGORY_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from './limits.js';
import { parseVersion } from './version.js';

export type FrontmatterErrorCode = 'missing_frontmatter' | 'schema_invalid';

/** Typed error for a malformed SKILL.md frontmatter (fail-loud, Unbreakable Rule 8). */
export class SkillFrontmatterError extends Error {
  readonly code: FrontmatterErrorCode;
  /**
   * Campo culpado, quando HÁ um. `undefined` para erros sem campo identificável (YAML
   * malformado, frontmatter ausente) — inventar um mandaria o editor pintar a linha errada
   * com confiança, que é pior que não pintar.
   */
  readonly field?: string;
  /** Linha 1-indexada no SKILL.md, para o editor posicionar o cursor. */
  readonly line?: number;

  constructor(code: FrontmatterErrorCode, message: string, field?: string, line?: number) {
    super(message);
    this.name = 'SkillFrontmatterError';
    this.code = code;
    if (field !== undefined) this.field = field;
    if (line !== undefined) this.line = line;
  }
}

/**
 * Linha 1-indexada de `campo:` no SKILL.md inteiro.
 *
 * Busca no texto completo (não só no bloco de frontmatter) porque é a linha que o editor abre.
 * `undefined` quando o campo não aparece — caso do campo AUSENTE, em que não há posição a dar.
 */
function linhaDoCampo(content: string, field: string): number | undefined {
  const linhas = content.split('\n');
  const re = new RegExp(`^\\s*${field}\\s*:`);
  const i = linhas.findIndex((l) => re.test(l));
  return i === -1 ? undefined : i + 1;
}

/**
 * Onde a skill EXECUTA — e, por consequência, o que o registry entrega ao agente.
 *
 * `remote`: a skill é INSTRUÇÃO. O agente descobre, escolhe e **carrega o corpo** do
 * servidor sob demanda; nada vai para o disco. É o caso comum, e por isso o default.
 *
 * `local`: a skill traz SCRIPT. Código precisa do sistema de arquivos, da rede e dos
 * segredos de quem executa, então ele roda na máquina do cliente — instalado via `npx`.
 * Não é preferência de entrega: é a única forma de a skill fazer o que promete.
 *
 * O campo importa porque o agente pode estar hospedado no Theo. Uma skill com script
 * entregue como instrução a um agente remoto produz um agente seguindo passos que
 * referenciam arquivos que não existem — falha plausível, que é a pior.
 */
export type SkillExecution = 'remote' | 'local';

export const SKILL_EXECUTIONS: readonly SkillExecution[] = ['remote', 'local'];

export interface SkillFrontmatter {
  /** Required. Theokit-compatible skill name. */
  readonly name: string;
  /** Required. What the skill does + when to use it. */
  readonly description: string;
  /**
   * Eixo de descoberta, TEXTO LIVRE (`Sales`, `Shop`, …). Opcional.
   *
   * Livre de propósito: uma lista fechada travaria quem publica numa taxonomia que nós
   * escolhemos hoje e ele descobre errada amanhã. O custo aceito é ruído no catálogo — e o
   * filtro é auxiliar da busca semântica, não substituto dela.
   */
  readonly category?: string;
  /** Onde executa. Default `remote` — ver {@link SkillExecution}. */
  readonly execution: SkillExecution;
  /**
   * Versão semântica (M27). Opcional — só quem usa canais precisa versionar, e exigi-la de
   * toda skill transformaria um registry de descoberta num gerenciador de pacotes.
   */
  readonly version?: string;
  /** Full parsed frontmatter — unknown fields preserved (forward-compat, ADR-4). */
  readonly fields: Readonly<Record<string, unknown>>;
}

// Leading `---\n ... \n---` block.
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
// AgentSkills name shape: lowercase alnum + hyphens, no leading/trailing hyphen.
const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Parse and validate a SKILL.md's YAML frontmatter using the `yaml` (eemeli)
 * parser (no js-yaml CVE; no code-exec surface). Required fields: name,
 * description. Unknown fields are preserved. Throws SkillFrontmatterError on any
 * malformation.
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) {
    throw new SkillFrontmatterError('missing_frontmatter', 'SKILL.md is missing YAML frontmatter');
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SkillFrontmatterError('schema_invalid', `malformed YAML frontmatter: ${detail}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SkillFrontmatterError('schema_invalid', 'frontmatter must be a YAML mapping');
  }
  const fields = parsed as Record<string, unknown>;

  const name = fields['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new SkillFrontmatterError('schema_invalid', 'missing required field: name', 'name', linhaDoCampo(content, 'name'));
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new SkillFrontmatterError('schema_invalid', `name exceeds ${MAX_NAME_LENGTH} characters`, 'name', linhaDoCampo(content, 'name'));
  }
  if (name.includes('--') || !NAME_RE.test(name)) {
    throw new SkillFrontmatterError('schema_invalid', 'name must be lowercase letters/digits/hyphens, no leading/trailing or consecutive hyphens', 'name', linhaDoCampo(content, 'name'));
  }

  const description = fields['description'];
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new SkillFrontmatterError('schema_invalid', 'missing required field: description', 'description', linhaDoCampo(content, 'description'));
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SkillFrontmatterError('schema_invalid', `description exceeds ${MAX_DESCRIPTION_LENGTH} characters`, 'description', linhaDoCampo(content, 'description'));
  }

  // `category` — texto livre, mas TEXTO. Um `42` coagido para "42" faria o filtro do
  // agente casar com algo que ninguém escreveu; uma lista viraria "[object Object]".
  const rawCategory = fields['category'];
  if (rawCategory !== undefined && rawCategory !== null && typeof rawCategory !== 'string') {
    throw new SkillFrontmatterError('schema_invalid', 'category must be a string', 'category', linhaDoCampo(content, 'category'));
  }
  const category = typeof rawCategory === 'string' && rawCategory.trim() !== '' ? rawCategory.trim() : undefined;
  if (category !== undefined && category.length > MAX_CATEGORY_LENGTH) {
    throw new SkillFrontmatterError('schema_invalid', `category exceeds ${MAX_CATEGORY_LENGTH} characters`, 'category', linhaDoCampo(content, 'category'));
  }

  // `execution` — default `remote` porque a maioria das skills é só instrução, e exigir o
  // campo faria toda skill trivial carregar cerimônia. Valor DESCONHECIDO é erro, nunca
  // default: um `execution: sandbox` caindo em `remote` entregaria como remota uma skill
  // que o autor quis restringir — o silêncio é o modo de falha perigoso.
  const rawExecution = fields['execution'];
  if (rawExecution !== undefined && rawExecution !== null && !SKILL_EXECUTIONS.includes(rawExecution as SkillExecution)) {
    throw new SkillFrontmatterError(
      'schema_invalid',
      `execution must be one of: ${SKILL_EXECUTIONS.join(' | ')}`,
    );
  }
  const execution: SkillExecution = (rawExecution as SkillExecution | undefined) ?? 'remote';

  // `version` — semver estrito, e MALFORMADA é erro, nunca ignorada: descartar em silêncio
  // deixaria a coluna nula, o canal invisível, e o autor procuraria o defeito no canal em vez
  // de no que ele escreveu.
  //
  // O typeof importa mais do que parece: sem aspas, o YAML lê `version: 1.0` como FLOAT, e
  // ele viraria a string "1". O autor escreveu uma versão e o registry gravaria outra —
  // divergência silenciosa entre o que ele leu e o que ficou. Só string é aceita.
  const rawVersion = fields['version'];
  let version: string | undefined;
  if (rawVersion !== undefined && rawVersion !== null) {
    if (typeof rawVersion !== 'string') {
      throw new SkillFrontmatterError(
        'schema_invalid',
        'version must be a quoted string (unquoted `1.0` is a YAML float and would become "1")',
      );
    }
    try {
      parseVersion(rawVersion);
    } catch (err) {
      throw new SkillFrontmatterError(
        'schema_invalid',
        `version is not valid semver: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    version = rawVersion;
  }

  return {
    name,
    description,
    ...(category !== undefined ? { category } : {}),
    execution,
    ...(version !== undefined ? { version } : {}),
    fields,
  };
}
