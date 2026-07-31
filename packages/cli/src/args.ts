import { parseArgs } from 'node:util';

export type CliCommand =
  | 'validate'
  | 'publish'
  | 'help'
  | 'init'
  | 'status'
  | 'get'
  | 'list'
  | 'revisions'
  | 'install';

export interface ParsedCli {
  readonly command: CliCommand;
  /** Positional argument — skill dir/zip (validate/publish) OR an id (status/get/revisions). */
  readonly path?: string;
  readonly registry?: string;
  readonly skillId?: string;
  /** Auth token (init flag, or carried from config at dispatch time). */
  readonly auth?: string;
  /** `install --global` → instala em `~/.claude/skills` em vez de no projeto. */
  readonly global?: boolean;
}

export class CliUsageError extends Error {}

const KNOWN: ReadonlySet<string> = new Set([
  'validate',
  'publish',
  'init',
  'status',
  'get',
  'list',
  'revisions',
  'install',
]);

/**
 * Parse `theoskill <command> [positional] [--registry url] [--skill-id id] [--auth token]`
 * using the Node stdlib `parseArgs` (no arg-parser dependency — parsimony ladder).
 */
export function parseCliArgs(argv: readonly string[]): ParsedCli {
  const command = argv[0];
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  if (!KNOWN.has(command)) {
    throw new CliUsageError(`unknown command: ${command}`);
  }
  const { values, positionals } = parseArgs({
    args: [...argv.slice(1)],
    allowPositionals: true,
    options: {
      registry: { type: 'string' },
      'skill-id': { type: 'string' },
      auth: { type: 'string' },
      global: { type: 'boolean' },
    },
  });
  const path = positionals[0];
  return {
    command: command as CliCommand,
    ...(path !== undefined ? { path } : {}),
    ...(values.registry !== undefined ? { registry: values.registry } : {}),
    ...(values['skill-id'] !== undefined ? { skillId: values['skill-id'] } : {}),
    ...(values.auth !== undefined ? { auth: values.auth } : {}),
    ...(values.global === true ? { global: true } : {}),
  };
}

/** Merge local config into parsed args — explicit flags always win (T3.2). Config
 * supplies `registry` and `auth` (the global, repeatable values); `skillId`/`path`
 * stay per-invocation. */
export function resolveArgs(
  parsed: ParsedCli,
  config: { readonly registry?: string; readonly auth?: string },
): ParsedCli {
  return {
    ...parsed,
    ...(parsed.registry === undefined && config.registry !== undefined ? { registry: config.registry } : {}),
    ...(parsed.auth === undefined && config.auth !== undefined ? { auth: config.auth } : {}),
  };
}

export const HELP_TEXT = `theoskill — Theo Skill Registry dev CLI

Usage:
  theoskill init --registry <url> [--auth <token>]   save local config (.theoskillrc)
  theoskill validate <path>                          validate a skill locally
  theoskill publish  <path> [--registry <url>] [--skill-id <id>]   validate + publish
  theoskill get      <skill-id>                      fetch a skill
  theoskill list                                     list skills
  theoskill status   <operation-id>                  poll an operation
  theoskill revisions <skill-id>                     list a skill's revisions

--registry/--skill-id/--auth fall back to .theoskillrc when omitted.
Exit code 0 on success, 1 on a registry/validation failure, 2 on usage/IO error.`;
