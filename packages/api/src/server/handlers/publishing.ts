import { type Hono } from 'hono';

import { requireScope } from '../auth/middleware.js';
import { type AppEnv, workspaceOf } from '../principal-context.js';
import { type BundlesStore } from '../store/bundles-store.js';
import { type ChannelsStore } from '../store/channels-store.js';
import { type SkillsStore } from '../store/skills-store.js';

export interface PublishingRoutesDeps {
  readonly channelsStoreFor: (workspaceId: string) => ChannelsStore;
  readonly bundlesStoreFor: (workspaceId: string) => BundlesStore;
  readonly skillsStoreFor: (workspaceId: string) => SkillsStore;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Rotas de PUBLICAÇÃO — canais e bundles (M27).
 *
 * O QUE ISTO CORRIGE. Os dois stores existiam completos e **sem chamador de produção**:
 * canal existia só no store, e `createBundlesStore` só era invocado por teste. Um publisher
 * não conseguia criar um bundle por meio suportado, então a distribuição inteira era
 * inalcançável — e os dois marcos estavam marcados como entregues.
 *
 * POR QUE ESCOPO DE PUBLICAÇÃO, e não de escrita. Mover um canal aponta **todos os
 * consumidores** que o seguem para outro conteúdo, e emitir uma credencial de bundle dá a um
 * terceiro acesso ao catálogo. Nenhuma das duas é escrita comum: são atos de publicação, e a
 * chave que os pratica precisa dizer isso.
 */
export function registerPublishingRoutes(app: Hono<AppEnv>, deps: PublishingRoutesDeps): void {
  const publica = requireScope('skills:publish');

  // ---- CANAIS ---------------------------------------------------------------------------

  /** Versões publicadas de uma skill — o insumo de quem vai promover um canal. */
  app.get('/v1/skills/:id/versions', async (c) => {
    const ws = workspaceOf(c);
    const skillId = c.req.param('id');
    // 404 cross-tenant antes de qualquer leitura de canal: sem isto, a existência de uma
    // skill alheia vazaria por uma lista de versões vazia vs. um 404.
    if ((await deps.skillsStoreFor(ws).getView(skillId)) === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const versoes = await deps.channelsStoreFor(ws).versionsOf(skillId);
    // Mapeado, nunca repassado cru: a forma do store é camelCase e a da API é snake_case.
    // Devolver o objeto do store congela um detalhe interno no contrato público — e a
    // divergência só aparece para quem consome, não para quem escreve o teste.
    return c.json({ versions: versoes.map((v) => ({ version: v.version, revision_id: v.revisionId })) }, 200);
  });

  app.get('/v1/skills/:id/channels', async (c) => {
    const ws = workspaceOf(c);
    const skillId = c.req.param('id');
    if ((await deps.skillsStoreFor(ws).getView(skillId)) === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const canais = await deps.channelsStoreFor(ws).list(skillId);
    return c.json(
      { channels: canais.map((x) => ({ channel: x.channel, revision_id: x.revisionId, previous_revision_id: x.previousRevisionId })) },
      200,
    );
  });

  /**
   * Promove uma revisão a um canal.
   *
   * Idempotente por desenho: promover a mesma revisão duas vezes é o caso normal de um
   * pipeline que reexecuta, e falhar nele obrigaria todo chamador a consultar antes.
   */
  app.put('/v1/skills/:id/channels/:channel', publica, async (c) => {
    const ws = workspaceOf(c);
    const skillId = c.req.param('id');
    if ((await deps.skillsStoreFor(ws).getView(skillId)) === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as { revision_id?: unknown } | null;
    const revisionId = typeof body?.revision_id === 'string' ? body.revision_id : '';
    if (revisionId === '') {
      return c.json({ error: 'invalid_request', details: 'revision_id obrigatório' }, 400);
    }

    const principal = c.get('principal');
    await deps.channelsStoreFor(ws).promote(skillId, c.req.param('channel'), revisionId, principal?.userId ?? null);
    return c.json({ skill_id: skillId, channel: c.req.param('channel'), revision_id: revisionId }, 200);
  });

  /** Volta o canal para a revisão anterior. `404` quando não há para onde voltar. */
  app.delete('/v1/skills/:id/channels/:channel', publica, async (c) => {
    const ws = workspaceOf(c);
    const ok = await deps.channelsStoreFor(ws).rollback(c.req.param('id'), c.req.param('channel'));
    return ok ? c.json({ rolled_back: true }, 200) : c.json({ error: 'not_found' }, 404);
  });

  // ---- BUNDLES --------------------------------------------------------------------------

  app.post('/v1/bundles', publica, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name === '') return c.json({ error: 'invalid_request', details: 'name obrigatório' }, 400);
    const bundleId = await deps.bundlesStoreFor(workspaceOf(c)).create(name);
    return c.json({ bundle_id: bundleId, name }, 201);
  });

  app.get('/v1/bundles', publica, async (c) => {
    const bundles = await deps.bundlesStoreFor(workspaceOf(c)).list();
    // `create_time` viaja porque a tela o mostra. Sem ele a coluna "Criado em" ficava `—` para
    // TODO pacote — medido no app-dev em 2026-08-04, inclusive num criado segundos antes. O dado
    // sempre existiu (`bundles.create_time`, `notNull().defaultNow()`); era a projeção que o
    // descartava. Mesma classe do `conversationId` que o theo-trust pagou: campo que a jornada
    // exige, ausente da resposta, transformando uma coluna em código morto.
    return c.json(
      {
        bundles: bundles.map((b) => ({
          bundle_id: b.bundleId,
          name: b.name,
          items: b.items,
          create_time: b.createTime.toISOString(),
        })),
      },
      200,
    );
  });

  /**
   * Define o conteúdo do bundle. Substitui a lista inteira, não faz merge: um bundle é o
   * recorte que o publisher entrega, e "adicionar" sem poder remover produziria pacotes que
   * só crescem — e um item esquecido lá dentro é acesso que ninguém pretendeu conceder.
   */
  app.put('/v1/bundles/:bundleId/items', publica, async (c) => {
    const ws = workspaceOf(c);
    const bundleId = c.req.param('bundleId');
    // O store é escopado, mas a checagem é explícita para responder 404 (nunca 403): um 403
    // confirmaria a existência do bundle de outro publisher.
    if ((await deps.bundlesStoreFor(ws).get(bundleId)) === null) {
      return c.json({ error: 'not_found' }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
    const brutos = Array.isArray(body?.items) ? body.items : null;
    if (brutos === null) return c.json({ error: 'invalid_request', details: 'items deve ser uma lista' }, 400);

    const items: { skillId: string; channel: string }[] = [];
    for (const it of brutos) {
      const o = it as { skill_id?: unknown; channel?: unknown };
      if (typeof o.skill_id !== 'string' || o.skill_id === '' || typeof o.channel !== 'string' || o.channel === '') {
        return c.json({ error: 'invalid_request', details: 'cada item precisa de skill_id e channel' }, 400);
      }
      items.push({ skillId: o.skill_id, channel: o.channel });
    }

    await deps.bundlesStoreFor(ws).setItems(bundleId, items);
    return c.json({ bundle_id: bundleId, items: items.length }, 200);
  });

  /**
   * Cunha a credencial que o cliente do cliente apresenta.
   *
   * `ttl_days` é OBRIGATÓRIO, ao contrário das chaves internas. Credencial entregue a
   * terceiro sem validade é a que ninguém lembra de revogar e sobrevive à relação comercial
   * que a justificava. Aceitar a omissão com um default seria escolher esse prazo em nome de
   * quem publica, sem que ele saiba.
   */
  app.post('/v1/bundles/:bundleId/tokens', publica, async (c) => {
    const ws = workspaceOf(c);
    const bundleId = c.req.param('bundleId');
    if ((await deps.bundlesStoreFor(ws).get(bundleId)) === null) {
      return c.json({ error: 'not_found' }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as
      | { ttl_days?: unknown; label?: unknown; quota_per_window?: unknown }
      | null;
    const ttlDays = typeof body?.ttl_days === 'number' ? body.ttl_days : 0;
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
      return c.json(
        { error: 'invalid_request', details: 'ttl_days obrigatório e > 0 — credencial de terceiro sem prazo não é revogada por ninguém' },
        400,
      );
    }

    const label = typeof body?.label === 'string' ? body.label : undefined;
    const quota = typeof body?.quota_per_window === 'number' ? body.quota_per_window : undefined;
    const minted = await deps.bundlesStoreFor(ws).mintToken(bundleId, {
      ttlMs: ttlDays * DIA_MS,
      ...(label !== undefined ? { label } : {}),
      ...(quota !== undefined ? { quotaPerWindow: quota } : {}),
    });

    // O valor cru sai UMA vez. Nada dele entra em log — telemetria tem retenção mais longa e
    // leitura mais ampla que o cofre de onde o segredo saiu.
    return c.json(
      { token_id: minted.tokenId, token: minted.token, expires_at: minted.expiresAt.toISOString() },
      201,
    );
  });

  /**
   * Os tokens de um bundle (M35) — identidade e ciclo de vida, nunca o segredo.
   *
   * Sem esta rota, `DELETE .../tokens/:tokenId` exigia um id que a tela não tinha como descobrir:
   * um token emitido pela CLI ou por outro operador era invisível e, na prática, irrevogável. O
   * store já sabia listar; faltava a porta.
   *
   * O 404 quando o bundle não é do workspace segue o contrato de não-enumeração do M11 — um 403
   * confirmaria que o bundle existe.
   */
  app.get('/v1/bundles/:bundleId/tokens', publica, async (c) => {
    const store = deps.bundlesStoreFor(workspaceOf(c));
    const bundleId = c.req.param('bundleId');
    if ((await store.get(bundleId)) === null) return c.json({ error: 'not_found' }, 404);
    const tokens = await store.listTokens(bundleId);
    return c.json(
      {
        bundle_id: bundleId,
        tokens: tokens.map((tk) => ({
          token_id: tk.tokenId,
          label: tk.label,
          quota_per_window: tk.quotaPerWindow,
          expires_at: tk.expiresAt.toISOString(),
          revoked_at: tk.revokedAt === null ? null : tk.revokedAt.toISOString(),
          create_time: tk.createTime.toISOString(),
        })),
      },
      200,
    );
  });

  app.delete('/v1/bundles/:bundleId/tokens/:tokenId', publica, async (c) => {
    const ok = await deps.bundlesStoreFor(workspaceOf(c)).revokeToken(c.req.param('tokenId'));
    return ok ? c.json({ revoked: true }, 200) : c.json({ error: 'not_found' }, 404);
  });
}
