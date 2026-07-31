/**
 * Single source of truth for skill-payload validation (M5). The server boundary
 * (`ingestPayload`) AND the dev CLI both call this so their checks can never
 * diverge (DRY — ROADMAP M5 risk #1). Runs the three checks in order:
 *   1. zip-safety  (PayloadValidator → yauzl: limits, traversal, symlink, ratio)
 *   2. frontmatter (parseFrontmatter: Theokit name/description rules)
 *   3. secret scan (SecretScanner → secretlint preset-recommend)
 * Returns a STRUCTURED result (does not throw on a rule violation) so the CLI can
 * render clear per-rule errors and the server can map to HTTP 400.
 */
import { parseFrontmatter, type SkillExecution, SkillFrontmatterError } from './frontmatter.js';
import { type PayloadValidator, PayloadValidationError, type ValidatedPayload } from './payload-validator.js';
import { type SecretScanner } from './secret-scanner.js';

/**
 * Extensões que denotam código executável. Lista deliberadamente CURTA e explícita — um
 * "tudo que não for texto" transformaria a guarda num imposto sobre skill normal, e o
 * objetivo não é proibir arquivo: é impedir que uma skill com script se declare remota.
 */
const SCRIPT_EXTENSIONS: readonly string[] = [
  '.sh', '.bash', '.zsh', '.fish',
  '.py', '.rb', '.pl', '.php', '.lua',
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts',
  '.ps1', '.bat', '.cmd', '.exe',
];

/**
 * Arquivos do pacote que são código executável.
 *
 * Dois sinais, porque um só deixa passar: a EXTENSÃO pega o caso comum, e o SHEBANG pega
 * `bin/tool` sem sufixo — que é exatamente como um script costuma ser empacotado.
 */
function scriptsNoPayload(files: readonly { readonly path: string; readonly content: string }[]): string[] {
  return files
    .filter((f) => {
      const p = f.path.toLowerCase();
      if (SCRIPT_EXTENSIONS.some((ext) => p.endsWith(ext))) return true;
      return f.content.startsWith('#!');
    })
    .map((f) => f.path);
}

export interface SkillValidationDeps {
  readonly payloadValidator: PayloadValidator;
  readonly secretScanner: SecretScanner;
}

export interface SkillValidationOk {
  readonly ok: true;
  readonly name: string;
  readonly description: string;
  /** Eixo de descoberta declarado pelo autor (texto livre). */
  readonly category?: string;
  /** Onde a skill executa — governa o que o registry entrega ao agente. */
  readonly execution: SkillExecution;
  /** Versão semântica declarada (M27). Ausente = skill não versionada. */
  readonly version?: string;
  readonly frontmatter: Record<string, unknown>;
  readonly validated: ValidatedPayload;
}

export interface SkillValidationFail {
  readonly ok: false;
  /** Stable rule code (same vocabulary the server returns as the 400 body). */
  readonly code: string;
  readonly message: string;
  /** Optional per-item detail (e.g. one line per secret finding). */
  readonly details?: readonly string[];
}

export type SkillValidationResult = SkillValidationOk | SkillValidationFail;

export async function validateSkillPayload(
  zip: Buffer,
  deps: SkillValidationDeps,
): Promise<SkillValidationResult> {
  // 1. zip-safety
  let validated: ValidatedPayload;
  try {
    validated = await deps.payloadValidator.validate(zip);
  } catch (err) {
    if (err instanceof PayloadValidationError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  // 2. frontmatter (Theokit rules)
  let name: string;
  let description: string;
  let frontmatter: Record<string, unknown>;
  let fm: ReturnType<typeof parseFrontmatter>;
  try {
    fm = parseFrontmatter(validated.skillMd);
    name = fm.name;
    description = fm.description;
    frontmatter = { ...fm.fields };
  } catch (err) {
    if (err instanceof SkillFrontmatterError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  // 3. secret scan
  const findings = await deps.secretScanner.scan(validated.files);
  if (findings.length > 0) {
    return {
      ok: false,
      code: 'secret_detected',
      message: `secret detected in ${findings.length} location(s)`,
      details: findings.map((f) => `${f.file}: ${f.type}`),
    };
  }

  // 4. execução × payload — uma skill com SCRIPT não pode se declarar remota.
  //
  // O agente remoto receberia instruções referenciando um arquivo que ele não tem, e o
  // sintoma não é um erro: é o agente seguindo passos que não existem. Falha plausível, que
  // é a pior. A guarda vive AQUI, na fronteira de publicação, e não no consumo: barrar na
  // hora de publicar dá o erro a quem pode corrigi-lo.
  //
  // Ela não proíbe script — exige honestidade. Declarar `execution: local` é a saída.
  if (fm.execution === 'remote') {
    const scripts = scriptsNoPayload(validated.files);
    if (scripts.length > 0) {
      return {
        ok: false,
        code: 'execution_requires_local',
        message: `payload contains executable script(s); declare \`execution: local\` in the frontmatter`,
        details: scripts,
      };
    }
  }


  return {
    ok: true,
    name,
    description,
    ...(fm.category !== undefined ? { category: fm.category } : {}),
    execution: fm.execution,
    ...(fm.version !== undefined ? { version: fm.version } : {}),
    frontmatter,
    validated,
  };
}
