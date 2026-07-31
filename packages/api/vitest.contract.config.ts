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
    include: ['tests/contract/**/*.test.ts'],
    testTimeout: 15_000,
    globals: false,
    passWithNoTests: false,
  },
});
