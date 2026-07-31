import { createHash, randomBytes } from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { roleSatisfies, type Scope } from '@usetheo/skills';
import { apiKeys } from '@usetheo/skills/db';
import { and, eq } from 'drizzle-orm';
import { type Hono } from 'hono';

import { API_KEY_PREFIX } from '../auth/oidc-verifier.js';
import { requireRole } from '../auth/require-role.js';
import { type Db } from '../db.js';
import { type AppEnv, getPrincipal } from '../principal-context.js';
import { type MembersStore } from '../store/members-store.js';

export interface AdminKeysRoutesDeps {
  readonly db: Db;
  readonly membersStoreFor: (workspaceId: string) => MembersStore;
}

const VALID_SCOPES: readonly Scope[] = ['skills:read', 'skills:write', 'skills:publish', 'skills:admin'];

/**
 * Cunhagem de chaves de API (M13 DoD #2 e #4).
 *
 * É AQUI que o privilégio nasce, e por isso é aqui que o teto é imposto — ver ADR 0007. O
 * portão de publicação do produto não é uma verificação por requisição; é esta rota.
 */
export function registerAdminKeysRoutes(app: Hono<AppEnv>, deps: AdminKeysRoutesDeps): void {
  const adminOnly = requireRole('admin', { membersStoreFor: deps.membersStoreFor });

  app.post('/v1/admin/keys', adminOnly, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { user_id?: unknown; scopes?: unknown } | null;
    const targetUserId = typeof body?.user_id === 'string' ? body.user_id : '';
    const rawScopes = Array.isArray(body?.scopes) ? body.scopes : [];
    if (targetUserId === '') return c.json({ error: 'invalid_request', details: 'user_id obrigatório' }, 400);

    const scopes = rawScopes.filter((s): s is Scope => VALID_SCOPES.includes(s as Scope));
    if (scopes.length !== rawScopes.length) {
      // Scope desconhecido é erro EXPLÍCITO, não silenciosamente descartado: descartar
      // entregaria uma chave com menos poder que o pedido, e a falha apareceria depois como
      // um 403 inexplicável no cliente.
      return c.json({ error: 'invalid_request', details: 'scope desconhecido' }, 400);
    }

    const actor = getPrincipal(c);
    if (actor.userId === null) return c.json({ error: 'forbidden' }, 403);
    const store = deps.membersStoreFor(actor.workspaceId);

    const targetRole = await store.roleOf(targetUserId);
    // 422 (não 403) para NÃO-MEMBRO — M13 DoD #4.
    //
    // Os dois códigos dizem coisas diferentes: `403` é "você não pode fazer isso" (requisição
    // bem formada, alvo válido); `422` é "esta requisição não faz sentido" — o alvo não é
    // membro, então não existe papel a comparar. Colapsar em 403 esconderia um erro de
    // digitação no `user_id` atrás de uma mensagem de permissão, e o operador procuraria um
    // problema de acesso que não existe.
    if (targetRole === null) {
      return c.json({ error: 'unprocessable', details: 'usuário não é membro do workspace' }, 422);
    }

    const actorRole = await store.roleOf(actor.userId);
    // ANTI-ESCALATION: cunhar para alguém de papel SUPERIOR é 403. Sem isto, um `admin`
    // emitiria uma chave em nome de um `owner` e herdaria o privilégio dele por procuração.
    if (actorRole === null || !roleSatisfies(actorRole, targetRole)) {
      return c.json({ error: 'forbidden' }, 403);
    }

    // O token cru é devolvido UMA vez e nunca mais: só o hash é persistido. Um store que
    // guardasse o valor transformaria um dump de banco no vazamento de todas as credenciais.
    const token = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
    const keyId = `key_${createId()}`;
    await deps.db.insert(apiKeys).values({
      keyId,
      workspaceId: actor.workspaceId,
      userId: targetUserId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scopes,
      revokedAt: null,
      expiresAt: null,
    });

    return c.json({ key_id: keyId, user_id: targetUserId, scopes, token }, 201);
  });

  app.delete('/v1/admin/keys/:keyId', adminOnly, async (c) => {
    const actor = getPrincipal(c);
    // Revogação é escopada ao workspace do ator: uma chave de outro tenant é 404, não 403 —
    // confirmar a existência dela permitiria enumerar chaves alheias por id.
    const res = await deps.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.workspaceId, actor.workspaceId), eq(apiKeys.keyId, c.req.param('keyId'))))
      .returning({ keyId: apiKeys.keyId });
    if (res.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });
}
