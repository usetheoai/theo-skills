#!/usr/bin/env node
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

import { type SkillValidationDeps } from '@usetheo/skills';
import { createSecretlintScanner, createYauzlPayloadValidator } from '@usetheo/skills-api/validators';

import { CliUsageError, HELP_TEXT, parseCliArgs, resolveArgs } from './args.js';
import { runInit } from './commands/init.js';
import { runPublish } from './commands/publish.js';
import { runRead } from './commands/read.js';
import { runValidate } from './commands/validate.js';
import { loadConfig } from './config.js';

/** Build the shared validation deps with the SAME adapters the server uses. */
function realValidation(): SkillValidationDeps {
  return { payloadValidator: createYauzlPayloadValidator(), secretScanner: createSecretlintScanner() };
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n${HELP_TEXT}\n`);
      return 2;
    }
    throw err;
  }

  const out = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  // Merge local .theoskillrc so registry/auth need not be repeated (flags still win).
  const args = resolveArgs(parsed, loadConfig());

  switch (args.command) {
    case 'help':
      out(HELP_TEXT);
      return 0;
    case 'init':
      return runInit(args, { out });
    case 'validate':
      return runValidate(args.path, { validation: realValidation(), out });
    case 'publish':
      return runPublish(args, { validation: realValidation(), out, fetch: globalThis.fetch });
    case 'get':
    case 'list':
    case 'status':
    case 'revisions': {
      if (args.registry === undefined || args.registry.length === 0) {
        out('no registry configured — pass --registry <url> or run `theoskill init`');
        return 2;
      }
      return runRead(args, {
        out,
        fetch: globalThis.fetch,
        registry: args.registry,
        ...(args.auth !== undefined ? { auth: args.auth } : {}),
      });
    }
  }
}

// Auto-run ONLY when invoked as the binary (not when imported by a test).
const entry = argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    });
}
