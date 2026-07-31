import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('./packages/core/src', import.meta.url));

/**
 * Categoria E2E — fluxos críticos de ponta a ponta, contra Postgres real.
 *
 * O Theo Architecture Standard § 4 prevê três categorias (unit co-locado, integração em
 * `tests/integration/`, E2E com config própria). Faltava a terceira: o README promete
 * "E2E — fluxos críticos: criar → recuperar por busca → obter revisão" e não havia como
 * executá-los isoladamente.
 *
 * POR QUE ESTE CONFIG AGREGA EM VEZ DE EXIGIR ARQUIVOS NOVOS: os E2E já existem e cobrem
 * exatamente o fluxo prometido —
 *   - `m1-e2e`          POST → operação done → GET skill com frontmatter + revisão
 *   - `m4-retrieve-e2e` criar skills → retrieve devolve a relevante no topo, com score
 *   - `cli-e2e`         validar → publicar pela CLI → skill recuperável; update cria rev 2
 * Escrever um quarto E2E que atravessasse o mesmo caminho seria duplicação de conhecimento
 * (DRY), não cobertura nova. O que faltava era a CATEGORIA, não o teste.
 *
 * Consequência: estes arquivos rodam em DOIS configs — aqui e no de integração do pacote.
 * É intencional: `test:integration` continua sendo a suíte completa por pacote, e
 * `test:e2e` é o corte rápido de "os fluxos críticos ainda funcionam?".
 */
export default defineConfig({
  resolve: {
    alias: {
      '@usetheo/skills/validators': `${coreSrc}/infrastructure/validators.ts`,
      '@usetheo/skills/contract': `${coreSrc}/contract/index.ts`,
      '@usetheo/skills/db': `${coreSrc}/infrastructure/db/schema.ts`,
      '@usetheo/skills': `${coreSrc}/index.ts`,
    },
  },
  test: {
    include: ['packages/*/tests/**/*e2e*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Os E2E compartilham o mesmo banco; paralelizar arquivos produziria interferência
    // entre fixtures (o mesmo motivo pelo qual o config de integração já serializa).
    fileParallelism: false,
    globals: false,
    passWithNoTests: false,
  },
});
