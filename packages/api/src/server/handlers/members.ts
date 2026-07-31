import { roleSatisfies, type WorkspaceRole } from '@usetheo/skills';
import { MemberAddSchema, MemberChangeRoleSchema } from '@usetheo/skills/contract';
import { type Hono } from 'hono';

import { requireRole } from '../auth/require-role.js';
import { type AppEnv, getPrincipal, workspaceOf } from '../principal-context.js';
import { LastOwnerError, type MembersStore } from '../store/members-store.js';

export interface MembersRoutesDeps {
  readonly membersStoreFor: (workspaceId: string) => MembersStore;
}

/**
 * Rotas de membros (M13 DoD #2) — todas exigem `admin`, per ADR 0007.
 *
 * Administrar membros é PERTENCIMENTO, não capacidade sobre o dado: por isso o portão aqui
 * é o papel, e não um scope.
 */
export function registerMembersRoutes(app: Hono<AppEnv>, deps: MembersRoutesDeps): void {
  const adminOnly = requireRole('admin', deps);

  app.get('/v1/members', adminOnly, async (c) => {
    const members = await deps.membersStoreFor(workspaceOf(c)).list();
    return c.json({ members }, 200);
  });

  app.put('/v1/members', adminOnly, async (c) => {
    const parsed = MemberAddSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);

    const actor = getPrincipal(c);
    // `requireRole` já barrou `userId === null` antes de chegar aqui; o estreitamento
    // explícito evita que a garantia vire suposição para o compilador — e para o leitor.
    if (actor.userId === null) return c.json({ error: 'forbidden' }, 403);
    const store = deps.membersStoreFor(actor.workspaceId);

    // ANTI-ESCALATION (M13 DoD #4): ninguém concede papel acima do próprio. Sem esta linha um
    // `admin` se promoveria a `owner` numa requisição, e o teto de privilégio deixaria de
    // existir — o portão de membership seria decorativo.
    const actorRole = await store.roleOf(actor.userId);
    if (actorRole === null || !roleSatisfies(actorRole, parsed.data.role)) {
      return c.json({ error: 'forbidden' }, 403);
    }

    await store.upsert(parsed.data.user_id, parsed.data.role);
    return c.json({ user_id: parsed.data.user_id, role: parsed.data.role }, 200);
  });

  app.patch('/v1/members/:userId', adminOnly, async (c) => {
    const parsed = MemberChangeRoleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);

    const actor = getPrincipal(c);
    if (actor.userId === null) return c.json({ error: 'forbidden' }, 403);
    const store = deps.membersStoreFor(actor.workspaceId);
    const target = c.req.param('userId');

    const targetRole = await store.roleOf(target);
    // 404 e não 403: um alvo que não é membro deste workspace é indistinguível de inexistente,
    // e confirmar a existência dele daria um oráculo de enumeração (mesmo contrato do M11).
    if (targetRole === null) return c.json({ error: 'not_found' }, 404);

    const actorRole = await store.roleOf(actor.userId);
    // O teto vale nos DOIS sentidos: não se concede papel acima do próprio, nem se mexe em
    // quem é mais privilegiado que você.
    if (actorRole === null || !roleSatisfies(actorRole, parsed.data.role) || !roleSatisfies(actorRole, targetRole)) {
      return c.json({ error: 'forbidden' }, 403);
    }

    try {
      await store.changeRole(target, parsed.data.role);
    } catch (err) {
      if (err instanceof LastOwnerError) return c.json({ error: 'last_owner' }, 409);
      throw err;
    }
    return c.json({ user_id: target, role: parsed.data.role }, 200);
  });

  app.delete('/v1/members/:userId', adminOnly, async (c) => {
    const actor = getPrincipal(c);
    if (actor.userId === null) return c.json({ error: 'forbidden' }, 403);
    const store = deps.membersStoreFor(actor.workspaceId);
    const target = c.req.param('userId');

    const targetRole = await store.roleOf(target);
    if (targetRole === null) return c.json({ error: 'not_found' }, 404);

    const actorRole = await store.roleOf(actor.userId);
    if (actorRole === null || !roleSatisfies(actorRole, targetRole)) {
      return c.json({ error: 'forbidden' }, 403);
    }

    try {
      await store.remove(target);
    } catch (err) {
      if (err instanceof LastOwnerError) return c.json({ error: 'last_owner' }, 409);
      throw err;
    }
    return c.body(null, 204);
  });
}

export type { WorkspaceRole };
