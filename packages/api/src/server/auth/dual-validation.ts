import { type AuthVerifier, type Principal } from '@usetheo/skills';

import { API_KEY_PREFIX } from './oidc-verifier.js';

export interface DualValidationDeps {
  readonly apiKey: AuthVerifier;
  readonly oidc: AuthVerifier;
}

/**
 * Roteia o token para o verificador certo pela FORMA dele (M12 DoD #1).
 *
 * Espelha o `dual-validation.ts` do theo-memory: `theo_live_*` → chave da casa; qualquer
 * outro Bearer → OIDC.
 *
 * O roteamento por prefixo — em vez de tentar um e cair no outro — é o ponto do desenho.
 * Fallback dobraria a latência de todo request OIDC e, pior, transformaria uma chave da
 * casa **revogada** numa consulta ao provedor externo: carga que não pedimos, latência que
 * o cliente paga, e um caminho em que uma credencial já negada volta a ser avaliada por
 * outro sistema.
 *
 * O nome "dual-validation" também cobre a JANELA DE ROTAÇÃO: durante a troca de uma chave,
 * a antiga e a nova coexistem no store e ambas resolvem — a rotação não derruba cliente em
 * produção, e quem expira a antiga é a data em `expiresAt`, não um corte manual.
 */
export function createDualValidationVerifier(deps: DualValidationDeps): AuthVerifier {
  return {
    resolvePrincipal(token: string): Promise<Principal | null> {
      // Uma falha de qualquer um dos dois PROPAGA — o middleware a traduz em 503.
      return token.startsWith(API_KEY_PREFIX)
        ? deps.apiKey.resolvePrincipal(token)
        : deps.oidc.resolvePrincipal(token);
    },
  };
}
