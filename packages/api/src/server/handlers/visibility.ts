import { skills } from '@usetheo/skills/db';
import { and, desc, eq, or } from 'drizzle-orm';
import { type Hono } from 'hono';

import { requireRole } from '../auth/require-role.js';
import { type Db } from '../db.js';
import { type AppEnv, getPrincipal } from '../principal-context.js';
import { type MembersStore } from '../store/members-store.js';

const VISIBILIDADES = ['private', 'shared', 'public'] as const;
type Visibilidade = (typeof VISIBILIDADES)[number];

export interface VisibilityRoutesDeps {
  readonly db: Db;
  readonly membersStoreFor: (workspaceId: string) => MembersStore;
}

/**
 * Promoção e revogação de visibilidade (M14 DoD #3 e #4).
 *
 * Exige `admin` porque promover a `public` **não é publicar conteúdo, é publicar código
 * executável para o agente de outro tenant**. É o risco #1 declarado do milestone, e o que
 * distingue este registry do theo-memory: memória é texto; skill é instrução.
 *
 * Curadoria explícita, portanto — não auto-publicação. E reversível: sem caminho de volta,
 * promover seria porta de mão única sobre código de terceiro.
 */
export function registerVisibilityRoutes(app: Hono<AppEnv>, deps: VisibilityRoutesDeps): void {
  const adminOnly = requireRole('admin', { membersStoreFor: deps.membersStoreFor });

  app.put('/v1/skills/:id/visibility', adminOnly, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { visibility?: unknown } | null;
    const alvo = body?.visibility;
    if (typeof alvo !== 'string' || !VISIBILIDADES.includes(alvo as Visibilidade)) {
      return c.json({ error: 'invalid_request', details: `visibility ∈ ${VISIBILIDADES.join('|')}` }, 400);
    }

    const actor = getPrincipal(c);
    const skillId = c.req.param('id');

    // A PROVENÊNCIA é gravada na mesma escrita da promoção (M14 DoD #3): quem promoveu e
    // quando. Reconstruí-la de um log depois seria arqueologia — e quem investiga uma skill
    // pública suspeita precisa da resposta agora, não de uma busca em índice de log.
    //
    // Ao revogar, a proveniência é LIMPA: mantê-la afirmaria que a skill está publicada por
    // alguém quando ela não está mais publicada por ninguém.
    const promovendo = alvo === 'public';
    const res = await deps.db
      .update(skills)
      .set({
        visibility: alvo,
        publishedBy: promovendo ? actor.userId : null,
        publishedAt: promovendo ? new Date() : null,
        updateTime: new Date(),
      })
      .where(and(eq(skills.workspaceId, actor.workspaceId), eq(skills.skillId, skillId)))
      .returning({ skillId: skills.skillId, visibility: skills.visibility });

    // 404 para skill de outro workspace — mesmo contrato de enumeração do M11.
    if (res.length === 0) return c.json({ error: 'not_found' }, 404);

    return c.json(
      {
        skill_id: skillId,
        visibility: alvo,
        ...(promovendo ? { published_by: actor.userId, published_at: new Date().toISOString() } : {}),
      },
      200,
    );
  });

  /** Proveniência de uma skill pública — quem a colocou no catálogo, e quando. */
  app.get('/v1/skills/:id/provenance', async (c) => {
    const actor = getPrincipal(c);
    const skillId = c.req.param('id');
    // A identidade de uma skill é o par (workspace_id, skill_id) — a PK é composta, e é de
    // propósito: como PK global, o primeiro inquilino a registrar `deploy-helper` bloquearia
    // o nome para todos os outros para sempre.
    //
    // Esta consulta filtrava SÓ por `skill_id`, com `limit(1)` e sem `ORDER BY`. Duas linhas
    // com o mesmo id em workspaces distintos são o caso NORMAL aqui, e a devolvida era
    // arbitrária (ordem de heap). Media dois modos de falha, e o segundo é o grave:
    //   1. 404 sobre a PRÓPRIA skill privada, sombreada por uma homônima alheia;
    //   2. devolver o `published_by` de OUTRA organização — um identificador de usuário
    //      dela — como se fosse a proveniência da skill perguntada.
    //
    // O predicado agora admite exatamente as duas linhas legítimas (a do ator e a pública) e
    // a ordenação dá precedência determinística à do próprio workspace.
    const rows = await deps.db
      .select({
        workspaceId: skills.workspaceId,
        visibility: skills.visibility,
        publishedBy: skills.publishedBy,
        publishedAt: skills.publishedAt,
      })
      .from(skills)
      .where(
        and(
          eq(skills.skillId, skillId),
          or(eq(skills.workspaceId, actor.workspaceId), eq(skills.visibility, 'public')),
        ),
      )
      .orderBy(desc(eq(skills.workspaceId, actor.workspaceId)))
      .limit(1);

    const r = rows[0];
    // Só skill PÚBLICA tem proveniência consultável por terceiros. Uma privada de outro
    // workspace responde 404 como sempre — a proveniência não pode virar a porta lateral
    // que revela a existência do que o isolamento esconde.
    if (r === undefined || (r.visibility !== 'public' && r.workspaceId !== actor.workspaceId)) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json(
      {
        skill_id: skillId,
        visibility: r.visibility,
        published_by: r.publishedBy,
        published_at: r.publishedAt?.toISOString() ?? null,
        // A skill é de outro workspace? O consumidor precisa saber ANTES de instalar.
        origin: r.workspaceId === actor.workspaceId ? 'own' : 'public',
      },
      200,
    );
  });
}
