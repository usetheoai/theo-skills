import { describe, expect, it } from 'vitest';

import { resolveAppOptionsFromEnv } from '../../src/server.js';

/**
 * O GATE QUE FALTAVA — a composição de PRODUÇÃO.
 *
 * O `/review` de 2026-07-31 encontrou, por três revisores independentes, que
 * `server.ts` construía o app como `createApp({ pool, queue, logger })`: auth, rate limit e
 * distribuição são opcionais e só montam quando passados, e **nenhum era**. Quatro milestones
 * ficaram escritos, testados e inalcançáveis, com `GET /v1/skills` respondendo 200 sem
 * credencial no serviço implantado.
 *
 * A causa de fundo não foi esquecimento: era que **nada testava a composição**. Todo teste
 * montava `createApp` com as opções à mão — provando um sistema que o binário não era. Este
 * arquivo fecha essa lacuna: verifica a tradução ambiente → opções, que é a decisão real.
 */
describe('resolveAppOptionsFromEnv', () => {
  it('sem env algum, auth fica DESLIGADA — e isso é deliberado, não descuido', () => {
    // Ligar por omissão devolveria 401 a todo chamador já integrado no deploy seguinte, sem
    // aviso. A exigência é decisão de operação; o wiring é que não pode faltar.
    const o = resolveAppOptionsFromEnv({});
    expect(o.authRequired).toBe(false);
    expect(o.rateLimit).toBeUndefined();
    expect(o.distribution).toBeUndefined();
  });

  it('`THEOSKILL_AUTH_REQUIRED=true` liga a exigência', () => {
    expect(resolveAppOptionsFromEnv({ THEOSKILL_AUTH_REQUIRED: 'true' }).authRequired).toBe(true);
    expect(resolveAppOptionsFromEnv({ THEOSKILL_AUTH_REQUIRED: '1' }).authRequired).toBe(true);
    expect(resolveAppOptionsFromEnv({ THEOSKILL_AUTH_REQUIRED: ' TRUE ' }).authRequired).toBe(true);
  });

  it('qualquer outro valor NÃO liga — fail-closed contra typo', () => {
    // `THEOSKILL_AUTH_REQUIRED=yes` ligando a exigência seria pior que não ligar: quem
    // escreveu `yes` acredita ter ativado. Só os dois valores documentados contam.
    for (const v of ['yes', 'sim', 'on', 'TRUE!', '2', '']) {
      expect(resolveAppOptionsFromEnv({ THEOSKILL_AUTH_REQUIRED: v }).authRequired, v).toBe(false);
    }
  });

  it('rate limit exige os DOIS números — meia proteção é pior que nenhuma', () => {
    // Ligar só o de leitura deixaria a escrita sem teto, passando a impressão de um guard
    // que não existe sobre a metade que mais importa.
    expect(resolveAppOptionsFromEnv({ THEOSKILL_RATE_LIMIT_READ: '100' }).rateLimit).toBeUndefined();
    expect(resolveAppOptionsFromEnv({ THEOSKILL_RATE_LIMIT_WRITE: '10' }).rateLimit).toBeUndefined();

    const o = resolveAppOptionsFromEnv({
      THEOSKILL_RATE_LIMIT_READ: '100',
      THEOSKILL_RATE_LIMIT_WRITE: '10',
    });
    expect(o.rateLimit).toEqual({ read: 100, write: 10, windowMs: 60000 });
  });

  it('valor não-numérico no rate limit NÃO liga um limite silencioso', () => {
    // `Number('abc')` é NaN, e `NaN > 0` é false — mas o teste trava isso, porque uma
    // mudança para `parseInt` mudaria o comportamento sem que nada reclamasse.
    expect(
      resolveAppOptionsFromEnv({ THEOSKILL_RATE_LIMIT_READ: 'abc', THEOSKILL_RATE_LIMIT_WRITE: '10' }).rateLimit,
    ).toBeUndefined();
  });

  it('janela do rate limit é configurável, com default de 60s', () => {
    const o = resolveAppOptionsFromEnv({
      THEOSKILL_RATE_LIMIT_READ: '5',
      THEOSKILL_RATE_LIMIT_WRITE: '5',
      THEOSKILL_RATE_LIMIT_WINDOW_MS: '1000',
    });
    expect(o.rateLimit?.windowMs).toBe(1000);
  });

  it('distribuição liga pela quota, e zero mantém desligada', () => {
    expect(resolveAppOptionsFromEnv({ THEOSKILL_DISTRIBUTION_QUOTA: '0' }).distribution).toBeUndefined();
    const o = resolveAppOptionsFromEnv({ THEOSKILL_DISTRIBUTION_QUOTA: '500' });
    expect(o.distribution).toEqual({ defaultQuota: 500, windowMs: 60000 });
  });
});
