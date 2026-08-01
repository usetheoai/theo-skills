import { describe } from 'vitest';

export const PG_URI = process.env['THEOSKILL_PG_URI'] ?? '';

const temBanco = PG_URI !== '';
/** Opt-out EXPLÍCITO para quem roda local sem Postgres. */
const pularPedido = (process.env['THEOSKILL_SKIP_INTEGRATION'] ?? '') !== '';

/**
 * Suíte de integração — pula só com opt-out explícito, nunca em silêncio.
 *
 * O QUE ISTO CORRIGE. Sem `THEOSKILL_PG_URI`, esta suíte reportava
 * `47 skipped (47) / 240 skipped (240)` e **saía com código 0**. Um runner de CI sem a
 * variável — ou com o nome errado dela — reportava SUCESSO sobre cobertura zero.
 *
 * É o pior formato de falha deste repositório, e o mesmo de vários defeitos que ele já
 * produziu: não há erro, não há log, e o portão fica verde sobre nada. Um gate que não mede
 * nada e diz "passou" é pior que gate nenhum — gate nenhum ao menos não engana.
 *
 * A intenção original (deixar rodar local sem banco) continua atendida por
 * `THEOSKILL_SKIP_INTEGRATION=1`. O que muda é de quem é a decisão: pular passa a ser algo
 * que alguém **pediu**, não o default de quem esqueceu de exportar uma variável.
 */
if (!temBanco && !pularPedido) {
  throw new Error(
    'THEOSKILL_PG_URI não está definida — a suíte de integração não mediria nada.\n' +
      '  • Para RODAR: THEOSKILL_PG_URI=postgres://theoskill:theoskill@localhost:15999/theoskill pnpm test:integration\n' +
      '  • Para PULAR: THEOSKILL_SKIP_INTEGRATION=1 pnpm test:integration\n' +
      'Pular em silêncio deixaria o gate verde sobre zero teste.',
  );
}

export const describeIntegration = describe.skipIf(!temBanco);
