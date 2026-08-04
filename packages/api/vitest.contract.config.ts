import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@usetheo/skills/migrate': `${coreSrc}/infrastructure/db/migrate.ts`,
      '@usetheo/skills/validators': `${coreSrc}/infrastructure/validators.ts`,
      '@usetheo/skills/contract': `${coreSrc}/contract/index.ts`,
      '@usetheo/skills/db': `${coreSrc}/infrastructure/db/schema.ts`,
      '@usetheo/skills': `${coreSrc}/index.ts`,
    },
  },
  test: {
    // `src/**` entra junto com os testes de contrato porque, sem isso, um teste unitário escrito
    // ao lado do código que ele protege **nunca é executado** — e um teste que não roda não
    // protege nada, por mais verde que pareça rodando à mão.
    //
    // MEDIDO em 2026-08-04: `src/eval/regression-gate.test.ts` e `src/eval/retrieve-response.ts`
    // estavam fora do alcance. O primeiro protege o gate de regressão do M34; foi reportado como
    // "6 passed" numa implementação e o CI nunca o tinha executado uma vez sequer.
    //
    // Os 62 de `tests/integration/` continuam fora daqui de propósito: exigem Postgres e têm
    // config própria (`vitest.integration.config.ts`). Essa metade é o issue #132.
    include: ['tests/contract/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15_000,
    globals: false,
    passWithNoTests: false,
  },
});
