import { defineConfig } from 'vitest/config';

/**
 * Suíte que trava os invariantes dos workflows (M10).
 *
 * Config própria na raiz porque os alvos são `.github/**` e o `Dockerfile` — não pertencem
 * a nenhum pacote. O Theo Architecture Standard § 4 admite `tests/` na raiz do workspace.
 */
export default defineConfig({
  test: {
    include: ['tests/workflows/**/*.test.ts'],
    environment: 'node',
  },
});
