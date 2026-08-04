import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { type Scope } from '@usetheo/skills';
import { apiKeys } from '@usetheo/skills/db';
import { type Hono } from 'hono';

import { API_KEY_PREFIX } from '../auth/oidc-verifier.js';
import { type Db } from '../db.js';
import { type Logger } from '../logger.js';
import { type AppEnv } from '../principal-context.js';

const VALID_SCOPES: readonly Scope[] = ['skills:read', 'skills:write', 'skills:publish', 'skills:admin'];

/**
 * Titular das chaves cunhadas pela plataforma.
 *
 * Um identificador reservado e reconhecível: quem auditar a tabela distingue de imediato uma
 * credencial de gateway de uma credencial de pessoa. Usar um `user_id` humano qualquer
 * atribuiria a atividade do gateway a alguém que não a praticou.
 */
const SYSTEM_USER_ID = 'sys_platform_gateway';

export interface PlatformKeysRoutesDeps {
  readonly db: Db;
  readonly logger: Logger;
  /** Credencial de plataforma. Ausente = rota NÃO registrada (fail-closed). */
  readonly platformAdminKey: string;
}

/** Comparação em tempo constante — o curto-circuito por tamanho evita o `RangeError`. */
function segredoConfere(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido, 'utf8'), Buffer.from(esperado, 'utf8'));
}

/**
 * `POST /v1/platform/keys` — cunhagem de plataforma (M22).
 *
 * POR QUE UMA ROTA SEPARADA da de admin, e não um caso especial dela.
 *
 * `POST /v1/admin/keys` deriva o workspace do **principal do chamador** e exige que o alvo
 * seja membro dele: é a rota de um humano administrando o próprio time, e o teto de
 * privilégio (anti-escalation) nasce ali. O control plane não consegue usá-la para cunhar em
 * um tenant arbitrário — que é exatamente o que o modelo de broker precisa fazer.
 *
 * Colapsar os dois casos numa rota só significaria enfraquecer as checagens de membro e de
 * escalada para um dos caminhos. Uma verificação de segurança com um "a menos que" é a que
 * ninguém audita depois. Rotas distintas, credenciais distintas, semânticas distintas.
 *
 * CONTROL PLANE vs DATA PLANE. A credencial aceita aqui é a de PLATAFORMA, e ela vive
 * exclusivamente no control plane — nunca no caminho de dados. Uma chave de usuário comum,
 * mesmo com `skills:admin`, **não** abre esta porta: se abrisse, qualquer credencial vazada
 * viraria um provisionador, e a separação que fecha o confused deputy deixaria de existir.
 *
 * FAIL-CLOSED. Sem a credencial configurada a rota não é registrada — responde 404 como
 * qualquer caminho inexistente. Um serviço que expõe provisionamento por omissão é pior que
 * um que não o expõe: o operador acredita que está desligado.
 */
export function registerPlatformKeysRoutes(app: Hono<AppEnv>, deps: PlatformKeysRoutesDeps): void {
  app.post('/v1/platform/keys', async (c) => {
    // 401, nunca 403: um 403 confirmaria a existência da rota a quem está tentando adivinhar
    // a credencial. O header ausente e o header errado respondem igual, pelo mesmo motivo.
    const header = c.req.header('authorization') ?? '';
    const apresentado = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (apresentado === '' || !segredoConfere(apresentado, deps.platformAdminKey)) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as { workspace_id?: unknown; scopes?: unknown } | null;
    const workspaceId = typeof body?.workspace_id === 'string' ? body.workspace_id : '';
    if (workspaceId === '') {
      return c.json({ error: 'invalid_request', details: 'workspace_id is required' }, 400);
    }

    const rawScopes = Array.isArray(body?.scopes) ? body.scopes : [];
    if (rawScopes.length === 0) {
      // Chave sem escopo algum não é uma chave restrita: é uma credencial inútil que passa a
      // existir, a expirar e a precisar de rotação sem nunca ter servido para nada.
      return c.json({ error: 'invalid_request', details: 'scopes cannot be empty' }, 400);
    }
    const scopes = rawScopes.filter((s): s is Scope => VALID_SCOPES.includes(s as Scope));
    if (scopes.length !== rawScopes.length) {
      // Explícito, nunca descartado em silêncio: descartar entregaria uma chave com menos
      // poder que o pedido, e a falha reapareceria depois como um 403 inexplicável no cliente.
      return c.json({ error: 'invalid_request', details: 'scope desconhecido' }, 400);
    }

    const token = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
    const keyId = `key_${createId()}`;
    await deps.db.insert(apiKeys).values({
      keyId,
      workspaceId,
      userId: SYSTEM_USER_ID,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scopes,
      revokedAt: null,
      expiresAt: null,
    });

    // O `key_id` e os escopos entram no log; o TOKEN nunca. Um segredo em log tem retenção
    // mais longa e leitura mais ampla que o cofre de onde saiu.
    deps.logger.info({ key_id: keyId, workspace_id: workspaceId, scopes }, 'platform key minted');

    return c.json({ key_id: keyId, workspace_id: workspaceId, scopes, token }, 201);
  });
}
