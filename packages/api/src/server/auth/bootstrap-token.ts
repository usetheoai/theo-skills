import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { type AuthVerifier, type Principal, type Scope } from '@usetheo/skills';

/**
 * Bootstrap token — a credencial de PRIMEIRO acesso (M12 DoD #1).
 *
 * O problema que ele resolve: um registry recém-instalado não tem chave alguma, e criar a
 * primeira exige uma chave. O bootstrap quebra esse ciclo com uma credencial de uso único,
 * fornecida pelo operador via ambiente.
 *
 * Três propriedades, e cada uma fecha um jeito conhecido de essa porta ficar aberta:
 *
 *  - **uso único** — consumido na primeira resolução bem-sucedida. Um bootstrap reutilizável
 *    é uma chave-mestra permanente em variável de ambiente, que é como esse recurso vira
 *    incidente meses depois de ninguém lembrar dele;
 *  - **scope máximo, tenant fixo** — resolve para `skills:admin` no workspace declarado, e
 *    nunca para um workspace arbitrário vindo da requisição;
 *  - **fail-closed por omissão** — sem a variável, ou com ela vazia, NENHUM token é aceito.
 *    Vazio precisa negar tudo, não aceitar tudo: é o erro clássico de comparar contra `''`.
 */
export interface BootstrapTokenDeps {
  /** Valor cru do token, tipicamente de `THEOSKILL_BOOTSTRAP_TOKEN`. Vazio/ausente = desligado. */
  readonly token: string | undefined;
  /** Workspace que o bootstrap administra. */
  readonly workspaceId: string;
}

/** Gera um token de bootstrap com entropia adequada (256 bits). */
export function generateBootstrapToken(): string {
  return `theoskill_boot_${randomBytes(32).toString('hex')}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  // Curto-circuito por comprimento: `timingSafeEqual` LANÇA em tamanhos diferentes, e o
  // throw viraria um 500 distinguível de um 401 — o oráculo que a comparação fecha.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export interface BootstrapVerifier extends AuthVerifier {
  /** `true` enquanto o bootstrap ainda não foi consumido e está habilitado. */
  isArmed(): boolean;
}

export function createBootstrapVerifier(deps: BootstrapTokenDeps): BootstrapVerifier {
  const configured = deps.token ?? '';
  // Hash em memória para não manter o segredo cru vivo além do necessário.
  const expectedHash = configured === '' ? null : createHash('sha256').update(configured).digest('hex');
  let consumed = false;

  return {
    isArmed(): boolean {
      return expectedHash !== null && !consumed;
    },

    resolvePrincipal(token: string): Promise<Principal | null> {
      // Fail-closed: desarmado (não configurado OU já consumido) nunca aceita.
      if (expectedHash === null || consumed || token === '') return Promise.resolve(null);

      const given = createHash('sha256').update(token).digest('hex');
      if (!constantTimeEquals(given, expectedHash)) return Promise.resolve(null);

      // Consome ANTES de devolver: se duas requisições chegarem juntas, a segunda já
      // encontra `consumed = true`. Node é single-threaded neste trecho síncrono, então
      // não há janela entre a checagem e a marcação.
      consumed = true;
      return Promise.resolve({
        workspaceId: deps.workspaceId,
        userId: 'bootstrap',
        role: 'owner',
        scopes: ['skills:admin'] as Scope[],
      });
    },
  };
}
