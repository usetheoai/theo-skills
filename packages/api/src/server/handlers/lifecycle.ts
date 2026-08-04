import { parseLifecycle, InvalidLifecycleError, type SkillLifecycle } from '@usetheo/skills';
import { skills } from '@usetheo/skills/db';
import { and, eq, isNull } from 'drizzle-orm';
import { type Hono } from 'hono';

import { requireRole } from '../auth/require-role.js';
import { type Db } from '../db.js';
import { type Logger } from '../logger.js';
import { type AppEnv, getPrincipal } from '../principal-context.js';
import { type MembersStore } from '../store/members-store.js';

/** Teto do motivo — alinhado ao `compatibility` da spec canônica (500 chars). */
const MAX_REASON = 500;

export interface LifecycleRoutesDeps {
  readonly db: Db;
  readonly membersStoreFor: (workspaceId: string) => MembersStore;
  readonly logger: Logger;
}

interface LifecycleBody {
  readonly lifecycle?: unknown;
  readonly enabled?: unknown;
  readonly reason?: unknown;
  readonly superseded_by?: unknown;
}

/**
 * `PUT /v1/skills/:id/lifecycle` — muda o estágio editorial de uma skill (M32).
 *
 * Arquivo próprio, e não mais uma rota em `handlers/skills.ts`: aquele arquivo está a três
 * linhas do teto de 500 (`rules/architecture.md`), e descobrir o estouro no fim da fase
 * forçaria um refactor não planejado.
 *
 * Exige `admin` pelo mesmo motivo da visibilidade: deprecar muda o que os agentes de todo o
 * workspace conseguem descobrir. É curadoria, não auto-serviço.
 *
 * O que esta rota NÃO faz, deliberadamente: validar transição de estado. Qualquer estágio pode
 * virar qualquer outro, inclusive `deprecated → active` (ADR D4). Não há caso concreto de
 * transição indevida, e uma máquina de estados para quatro valores sem comportamento próprio
 * seria cerimônia — `rules/parsimony-ladder.md` rung 1. Se o caso aparecer, é milestone próprio.
 */
export function registerLifecycleRoutes(app: Hono<AppEnv>, deps: LifecycleRoutesDeps): void {
  const adminOnly = requireRole('admin', { membersStoreFor: deps.membersStoreFor });

  app.put('/v1/skills/:id/lifecycle', adminOnly, async (c) => {
    const body = (await c.req.json().catch(() => null)) as LifecycleBody | null;

    let alvo: SkillLifecycle;
    try {
      alvo = parseLifecycle(typeof body?.lifecycle === 'string' ? body.lifecycle : '');
    } catch (err) {
      // O erro do domínio já enumera o vocabulário aceito; repassá-lo é melhor que parafrasear,
      // porque a paráfrase envelhece quando o vocabulário muda.
      const detail = err instanceof InvalidLifecycleError ? err.message : 'lifecycle is required';
      return c.json({ error: 'invalid_request', field: 'lifecycle', details: detail }, 400);
    }

    // A habilitação é o SEGUNDO eixo, e precisa de escritor de produção: sem ele,
    // `include_disabled=true` seria uma flag pública que opta por um estado que a aplicação
    // não consegue criar — capacidade anunciada e inalcançável. Omitir preserva o valor atual,
    // porque desligar e descontinuar são ações distintas e não devem se arrastar uma à outra.
    if (body?.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return c.json(
        { error: 'invalid_request', field: 'enabled', details: 'enabled must be a boolean' },
        400,
      );
    }
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined;

    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const supersededBy = typeof body?.superseded_by === 'string' ? body.superseded_by.trim() : '';

    // Motivo é obrigatório APENAS ao descontinuar: ir para `active` ou `draft` não tira nada de
    // ninguém, e exigir justificativa para isso seria burocracia sem leitor.
    if (alvo === 'deprecated' && reason.length === 0) {
      return c.json(
        {
          error: 'invalid_request',
          field: 'reason',
          details:
            'reason is required when deprecating — a consumer that learns a skill is deprecated ' +
            'without knowing why has the same information as a 404',
        },
        400,
      );
    }
    if (reason.length > MAX_REASON) {
      return c.json(
        { error: 'invalid_request', field: 'reason', details: `reason exceeds ${MAX_REASON} chars` },
        400,
      );
    }

    const actor = getPrincipal(c);
    const skillId = c.req.param('id');

    // A sucessora precisa existir NO MOMENTO da escrita. Não impedimos que ela seja deprecada
    // depois: proibir exigiria varredura reversa a cada deprecação, e uma cadeia de deprecadas
    // continua legível — o consumidor segue o ponteiro e encontra outro aviso, que é informação,
    // não quebra.
    if (supersededBy.length > 0) {
      if (supersededBy === skillId) {
        return c.json(
          { error: 'invalid_request', field: 'superseded_by', details: 'a skill cannot supersede itself' },
          400,
        );
      }
      const sucessora = await deps.db
        .select({ skillId: skills.skillId })
        .from(skills)
        .where(
          and(
            eq(skills.workspaceId, actor.workspaceId),
            eq(skills.skillId, supersededBy),
            isNull(skills.deletedAt),
          ),
        )
        .limit(1);
      if (sucessora.length === 0) {
        return c.json(
          { error: 'invalid_request', field: 'superseded_by', details: 'successor skill not found' },
          400,
        );
      }
    }

    const deprecando = alvo === 'deprecated';
    const res = await deps.db
      .update(skills)
      .set({
        lifecycle: alvo,
        ...(enabled !== undefined ? { enabled } : {}),
        // Ao sair de `deprecated`, os dois campos são LIMPOS: manter o motivo afirmaria que a
        // skill está descontinuada por uma razão quando ela não está mais descontinuada.
        deprecationReason: deprecando ? reason : null,
        supersededBy: deprecando && supersededBy.length > 0 ? supersededBy : null,
        updateTime: new Date(),
      })
      // `deleted_at IS NULL`: uma skill tombstoned não tem ciclo de vida a mudar. Sem esta
      // cláusula a rota devolvia 200 sobre uma skill apagada, divergindo de `skills-store.ts`,
      // que filtra soft-delete em toda leitura e escrita.
      .where(
        and(
          eq(skills.workspaceId, actor.workspaceId),
          eq(skills.skillId, skillId),
          isNull(skills.deletedAt),
        ),
      )
      .returning({ skillId: skills.skillId, lifecycle: skills.lifecycle });

    // 404 para skill de outro workspace — mesmo contrato de não-enumeração do M11: um 403
    // confirmaria que o recurso existe.
    if (res.length === 0) return c.json({ error: 'not_found' }, 404);

    // Auditoria: quem mudou, o quê, para qual estágio. Sem isto, `deprecated → active` seria
    // invisível — e é justamente a transição que o ADR D4 permite sem cerimônia.
    deps.logger.info(
      {
        workspace_id: actor.workspaceId,
        actor: actor.userId,
        skill_id: skillId,
        lifecycle: alvo,
        has_successor: supersededBy.length > 0,
      },
      'skill.lifecycle.changed',
    );

    return c.json({
      skill_id: skillId,
      lifecycle: alvo,
      ...(enabled !== undefined ? { enabled } : {}),
      reason: deprecando ? reason : null,
      superseded_by: deprecando && supersededBy.length > 0 ? supersededBy : null,
    });
  });
}
