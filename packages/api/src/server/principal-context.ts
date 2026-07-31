import { DEFAULT_PRINCIPAL, type Principal } from '@usetheo/skills';
import { type Context } from 'hono';

/**
 * Tipagem das variáveis de contexto do Hono (M11).
 *
 * Sem isto, `c.set('principal', …)` não compila: o Hono infere `never` para as chaves de
 * um app sem `Variables` declarado.
 */
export interface AppVariables {
  readonly principal: Principal;
}

/** App Hono com o Principal no contexto. */
export interface AppEnv { Variables: AppVariables }

/**
 * O Principal da requisição corrente.
 *
 * O fallback para {@link DEFAULT_PRINCIPAL} cobre APENAS o caminho em que nenhum resolver foi
 * montado (a ponte legada single-tenant). Ele NÃO é o default de uma falha de autenticação:
 * quando M12 existir e o backend de auth falhar, a resposta é `503` — jamais um Principal
 * privilegiado por omissão (fail-closed).
 */
export function getPrincipal(c: Context<AppEnv>): Principal {
  return c.get('principal') ?? DEFAULT_PRINCIPAL;
}

/** Atalho para o inquilino — o valor que escopa todo store. */
export function workspaceOf(c: Context<AppEnv>): string {
  return getPrincipal(c).workspaceId;
}
