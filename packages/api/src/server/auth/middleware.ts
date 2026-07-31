import {
  type AuthVerifier,
  DEFAULT_PRINCIPAL,
  type Principal,
  type Scope,
  scopeSatisfies,
} from '@usetheo/skills';
import { type Context, type MiddlewareHandler, type Next } from 'hono';

import { type AppEnv } from '../principal-context.js';

export interface AuthMiddlewareDeps {
  readonly verifier: AuthVerifier;
  /**
   * `false` liga o BRIDGE LEGADO (M12 DoD #3): sem credencial, a requisição colapsa no
   * workspace `default` em vez de ser recusada. Existe para o M12 entrar sem quebrar quem
   * já consome a API sem credencial — e o padrão é `true`, fechado, porque uma porta que
   * abre por omissão de configuração é a que fica aberta.
   */
  readonly authRequired?: boolean;
}

/** Extrai o token de `Authorization: Bearer <token>`, ou `null`. */
function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  // Esquema case-insensitive por RFC 6750 § 2.1. O token vem VERBATIM: aparar espaço
  // mudaria o segredo comparado e faria uma chave legítima falhar por "limpeza".
  const m = /^bearer (.*)$/is.exec(header);
  return m?.[1] ?? null;
}

/**
 * Middleware de autenticação (M12 DoD #3).
 *
 * A ordem das respostas é o contrato, e ela é resolvida AQUI, antes de qualquer verificação
 * de scope: uma credencial inválida sai como `401` mesmo numa rota que exige scope. Deixar
 * o `403` vir primeiro daria a quem não tem credencial um oráculo para descobrir quais
 * rotas existem e que scope cada uma pede.
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps): MiddlewareHandler<AppEnv> {
  const authRequired = deps.authRequired ?? true;
  return async (c: Context<AppEnv>, next: Next) => {
    const token = bearerToken(c.req.header('authorization'));

    if (token === null) {
      if (!authRequired) {
        c.set('principal', DEFAULT_PRINCIPAL);
        return next();
      }
      return c.json({ error: 'unauthorized' }, 401);
    }

    let principal: Principal | null;
    try {
      principal = await deps.verifier.resolvePrincipal(token);
    } catch {
      // 503, NUNCA acesso: quando o backend de auth cai, "não sei quem é" precisa negar.
      // O erro original não vai no corpo — ele carrega detalhe de infraestrutura, e a
      // mensagem de indisponibilidade não deve virar canal de vazamento.
      return c.json({ error: 'auth_unavailable' }, 503);
    }

    if (principal === null) return c.json({ error: 'unauthorized' }, 401);

    c.set('principal', principal);
    return next();
  };
}

/**
 * Exige um scope na rota (M12 DoD #2 e #4).
 *
 * Roda DEPOIS do middleware de autenticação, então quando chega aqui o principal já é
 * confiável — e um `403` daqui significa exatamente "você é quem diz ser, e não pode".
 */
export function requireScope(required: Scope): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const principal = c.get('principal');
    // `scopes` é `readonly string[]` no Principal (contrato do M11); o estreitamento para
    // `Scope` acontece aqui, na fronteira que decide — e `scopeSatisfies` é fail-closed
    // para qualquer valor fora do union.
    if (!scopeSatisfies(principal.scopes as readonly Scope[], required)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return next();
  };
}
