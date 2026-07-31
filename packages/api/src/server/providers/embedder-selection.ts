import {
  createOpenAIEmbedder,
  createStubEmbedder,
  type EmbeddingProvider,
} from '@usetheo/skills';

export interface SelectEmbedderOptions {
  /** Explicit injection (test seam / advanced reuse) — wins over env. */
  explicit?: EmbeddingProvider;
  /** Env source (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

/** A provider rule: detect from env → create (M9 / gap #7, ADR-3). Ordered; the
 * first rule whose `detect` is true wins. Adding a provider = adding an entry —
 * `selectEmbedder` never changes (OCP). YAGNI: we ship ONLY the openai rule beyond
 * the stub fallback; no speculative 3rd provider lands without a real consumer. */
export interface ProviderRule {
  readonly name: string;
  readonly detect: (env: NodeJS.ProcessEnv) => boolean;
  readonly create: () => EmbeddingProvider;
}

const PROVIDER_REGISTRY: readonly ProviderRule[] = Object.freeze([
  {
    name: 'openai',
    detect: (env) => (env['OPENAI_API_KEY'] ?? '').length > 0, // honors OPENAI_BASE_URL inside the adapter
    create: () => createOpenAIEmbedder({}),
  },
]);

/** Resolve a provider from an explicit ordered registry (testable OCP seam). */
export function selectFromRegistry(
  registry: readonly ProviderRule[],
  opts: SelectEmbedderOptions = {},
): EmbeddingProvider {
  if (opts.explicit !== undefined) {
    return opts.explicit; // injection wins — same port, no domain change
  }
  const env = opts.env ?? process.env;
  for (const rule of registry) {
    if (rule.detect(env)) {
      return rule.create();
    }
  }
  return createStubEmbedder(); // deterministic offline fallback
}

/**
 * Choose the embedding provider WITHOUT touching the domain (DIP), via the ordered
 * PROVIDER_REGISTRY. With `OPENAI_API_KEY` set → openai; otherwise the deterministic
 * stub. Explicit injection always wins, so tests and the embed worker share one selection.
 */
export function selectEmbedder(opts: SelectEmbedderOptions = {}): EmbeddingProvider {
  return selectFromRegistry(PROVIDER_REGISTRY, opts);
}
