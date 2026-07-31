import { type AuthVerifier, type Principal } from '@usetheo/skills';

/**
 * Prefixo das chaves emitidas pela casa.
 *
 * É o discriminador do roteamento em {@link createDualValidationVerifier}: a FORMA do token
 * diz qual verificador o atende, sem tentativa-e-erro.
 */
export const API_KEY_PREFIX = 'theoskill_live_';

/** Resposta de introspecção RFC 7662 (só os campos que consumimos). */
export interface IntrospectResponse {
  readonly active?: unknown;
  readonly sub?: unknown;
  readonly workspace_id?: unknown;
  readonly scope?: unknown;
}

/** Port de introspecção — o adapter de produção fala com o provedor OIDC. */
export type IntrospectFn = (token: string) => Promise<IntrospectResponse>;

export interface OidcVerifierDeps {
  readonly introspect: IntrospectFn;
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Adapter OIDC do {@link AuthVerifier} (RFC 7662 token introspection).
 *
 * FAIL-CLOSED no ponto que mais importa num sistema multi-tenant: um token **ativo** que não
 * traga a claim de workspace resolve para `null`. Assumir o workspace `default` nesse caso
 * daria a um usuário emitido por provedor externo acesso ao tenant compartilhado — e seria
 * um furo silencioso, porque o token é legítimo e o log não mostraria nada de anormal.
 */
export function createOidcVerifier(deps: OidcVerifierDeps): AuthVerifier {
  return {
    async resolvePrincipal(token: string): Promise<Principal | null> {
      if (token === '') return null;

      // Uma falha aqui PROPAGA: indisponibilidade do provedor não é "token inválido".
      // O middleware traduz em 503.
      const res = await deps.introspect(token);

      if (res.active !== true) return null;

      const userId = asString(res.sub);
      const workspaceId = asString(res.workspace_id);
      if (userId === null || workspaceId === null) return null;

      // `scope` é string separada por espaço (RFC 6749 § 3.3). Ausente = nenhum scope:
      // o token autentica, e o `requireScope` nega depois — 401 e 403 continuam distintos.
      const raw = asString(res.scope);
      const scopes = raw === null ? [] : raw.split(' ').filter((s) => s !== '');

      return { workspaceId, userId, role: 'member', scopes: scopes };
    },
  };
}
