import { defineConfig } from 'vitest/config';

/**
 * Suíte que trava os invariantes de arquivos que não pertencem a pacote nenhum.
 *
 * Config própria na raiz porque os alvos são `.github/**`, o `Dockerfile` e — desde o
 * portão de idioma (T0.1) — a árvore inteira do repositório. O Theo Architecture Standard
 * § 4 admite `tests/` na raiz do workspace.
 */
export default defineConfig({
  test: {
    include: ['tests/workflows/**/*.test.ts', 'tests/repo/**/*.test.ts'],
    environment: 'node',
  },
});
