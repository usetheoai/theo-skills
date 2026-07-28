import { type SkillValidationDeps, validateSkillPayload } from '@usetheo/skills';

import { packageSkill } from '../zip.js';

export interface ValidateDeps {
  readonly validation: SkillValidationDeps;
  /** Output sink (real CLI passes console.log/console.error). */
  readonly out: (line: string) => void;
  /** Packager (injectable for tests). */
  readonly package?: (path: string) => Promise<Buffer>;
}

/**
 * `theoskill validate <path>` — run the SAME checks as the server boundary
 * (shared `validateSkillPayload`) against a local skill. Returns the process exit
 * code (0 ok, 1 invalid, 2 usage/IO error) and prints a clear per-rule message.
 */
export async function runValidate(path: string | undefined, deps: ValidateDeps): Promise<number> {
  if (path === undefined) {
    deps.out('error: validate requires a <path> (skill directory, SKILL.md, or .zip)');
    return 2;
  }
  let buffer: Buffer;
  try {
    buffer = await (deps.package ?? packageSkill)(path);
  } catch (err) {
    deps.out(`error: could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const result = await validateSkillPayload(buffer, deps.validation);
  if (result.ok) {
    deps.out(`ok: ${path} is a valid skill (name: ${result.name})`);
    return 0;
  }
  deps.out(`invalid: ${path}`);
  deps.out(`  - [${result.code}] ${result.message}`);
  for (const d of result.details ?? []) {
    deps.out(`      · ${d}`);
  }
  return 1;
}
