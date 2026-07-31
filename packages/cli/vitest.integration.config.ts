import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));
const apiSrc = fileURLToPath(new URL('../api/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // O subpath vem ANTES do alias genérico: `@usetheo/skills` casaria
      // `@usetheo/skills/validators` e o resolveria como diretório dentro de index.ts.
      '@usetheo/skills/validators': `${coreSrc}/infrastructure/validators.ts`,
      '@usetheo/skills/contract': `${coreSrc}/contract/index.ts`,
      '@usetheo/skills/db': `${coreSrc}/infrastructure/db/schema.ts`,
      '@usetheo/skills': `${coreSrc}/index.ts`,
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    globals: false,
    passWithNoTests: true,
  },
});
