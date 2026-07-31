import { roleSatisfies, type WorkspaceRole } from '@usetheo/skills';
import { type Context, type MiddlewareHandler, type Next } from 'hono';

import { type AppEnv } from '../principal-context.js';
import { type MembersStore } from '../store/members-store.js';

export interface RequireRoleDeps {
  readonly membersStoreFor: (workspaceId: string) => MembersStore;
}

/**
 * Exige um papel MÍNIMO no workspace (M13 DoD #2).
 *
 * Complementa `requireScope`, não o substitui — a ortogonalidade está registrada no
 * ADR 0007: `scopes` governam CAPACIDADE sobre o dado (publicar, ler); `role` governa
 * PERTENCIMENTO (administrar membros, cunhar chave). São eixos distintos, e as rotas
 * administrativas usam este.
 *
 * DEFAULT-DENY (M13 DoD #1): o papel vem da tabela de membros, e quem não é membro não tem
 * papel — resolve para negado, nunca para `member` por omissão. O papel que possa vir no
 * `Principal` NÃO é consultado aqui: ele pode ter origem num token externo (OIDC) que não
 * conhece nossa tabela de membership, e aceitá-lo deixaria o provedor de identidade decidir
 * quem administra nosso workspace.
 */
export function requireRole(min: WorkspaceRole, deps: RequireRoleDeps): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const principal = c.get('principal');
    // `userId` é `string | null` DE PROPÓSITO (ver `principal.ts`): uma credencial de
    // workspace sem membro tem `null`. Ela não pode administrar membros — não há a QUEM
    // aplicar o teto de privilégio do anti-escalation. Negar aqui é o default-deny do
    // DoD #1, e é mais honesto que inventar um papel para uma identidade que não existe.
    if (principal.userId === null) return c.json({ error: 'forbidden' }, 403);
    const role = await deps.membersStoreFor(principal.workspaceId).roleOf(principal.userId);
    if (role === null || !roleSatisfies(role, min)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return next();
  };
}
