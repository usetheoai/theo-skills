import { type AuthVerifier } from '@usetheo/skills';
import {
  DEFAULT_PRINCIPAL,
  type EmbeddingProvider,
  type PayloadValidator,
  type Principal,
  type SecretScanner,
} from '@usetheo/skills';
import { Hono, type Context } from 'hono';
import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';

import { createAuthMiddleware } from './auth/middleware.js';
import { createDb } from './db.js';
import { registerHealthRoutes } from './handlers/health.js';
import { registerOperationsRoutes } from './handlers/operations.js';
import { registerRetrieveRoutes } from './handlers/retrieve.js';
import { registerSkillsRoutes } from './handlers/skills.js';
import { registerVersionRoutes } from './handlers/version.js';
import { registerWebhookEndpointRoutes } from './handlers/webhook-endpoints.js';
import { createJsonLogger, type Logger } from './logger.js';
import { createSecretlintScanner } from './payload/secretlint-scanner.js';
import { createYauzlPayloadValidator } from './payload/yauzl-validator.js';
import { type AppEnv } from './principal-context.js';
import { selectEmbedder } from './providers/embedder-selection.js';
import { createDispatchingRetriever } from './providers/retriever-selection.js';
import { createPgExecutor } from './retrieve/pg-executor.js';
import { createOperationsStore } from './store/operations-store.js';
import { createRevisionsStore } from './store/revisions-store.js';
import { createSkillsStore } from './store/skills-store.js';
import { createWebhookEndpointsStore } from './store/webhook-endpoints-store.js';
import { type DnsResolver } from './webhooks/url-safety.js';

const DEFAULT_RESERVATION_HOURS = 24;
const DEFAULT_MAX_BODY_BYTES = 35 * 1024 * 1024; // ~25MB zip after base64 envelope

export interface CreateAppOptions {
  readonly pool: Pool;
  readonly queue: PgBoss;
  readonly logger?: Logger;
  readonly payloadValidator?: PayloadValidator;
  readonly secretScanner?: SecretScanner;
  readonly reservationHours?: number;
  readonly maxBodyBytes?: number;
  /** Injectable DNS resolver for the webhook SSRF guard (tests stub this). */
  readonly dnsResolver?: DnsResolver;
  /** Embedder for the retrieve endpoint (defaults to env-selected). */
  readonly embedder?: EmbeddingProvider;
  /**
   * Resolve QUEM esta chamando — o inquilino e suas capacidades (M11).
   *
   * PORTA, e nao cabecalho, DE PROPOSITO (ADR-M11-2). Aceitar um `x-workspace-id` tornaria o
   * isolamento falsificavel por qualquer cliente: bastaria trocar o cabecalho para ler o
   * catalogo alheio. Enquanto a autenticacao real nao existe (M12), o default resolve para
   * o workspace `default` — a ponte legada, que mantem a instalacao single-tenant intacta.
   *
   * Os testes injetam resolvers distintos para provar isolamento SEM abrir essa porta.
   */
  readonly principalResolver?: (c: Context<AppEnv>) => Principal;
  /**
   * Verificador de credencial (M12). Quando presente, o middleware de auth substitui o
   * `principalResolver` e passa a governar a fronteira: `401` sem credencial válida,
   * `403` com scope insuficiente, `503` quando o backend cai.
   *
   * Ausente = BRIDGE LEGADO: toda requisição colapsa no workspace `default`. É o estado
   * de hoje, preservado de propósito para o M12 entrar sem quebrar quem já consome a API
   * — e o `SECURITY.md` continua declarando que o serviço não deve ser exposto assim.
   */
  readonly authVerifier?: AuthVerifier;
}

/** Build the Hono app with injected dependencies (DIP, ADR-3). */
export function createApp(opts: CreateAppOptions): Hono<AppEnv> {
  const db = createDb(opts.pool);
  const logger = opts.logger ?? createJsonLogger();

  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  // ROTAS PÚBLICAS — registradas ANTES do middleware de auth de propósito.
  //
  // No Hono um middleware só alcança as rotas registradas DEPOIS dele, então a ordem aqui
  // É o mecanismo, não convenção. `/v1/health` e `/v1/version` ficam abertos porque atrás
  // de credencial "o serviço caiu" e "minha credencial está errada" produzem a mesma
  // resposta, e quem monitora não consegue separar os dois. O painel /status do TheoCloud e
  // o reconciliador do dev host leem exatamente `/v1/version` sem credencial alguma —
  // fechá-los quebraria a observabilidade da frota inteira, e foi o que um teste de wiring
  // pegou antes de virar incidente.
  registerHealthRoutes(app);
  registerVersionRoutes(app);

  // O Principal e resolvido UMA vez por requisicao e carregado no contexto; os stores sao
  // construidos JA ESCOPADOS a ele. Nenhum handler recebe um store global.
  // Com verificador, a fronteira é o middleware de auth — ele resolve o Principal a partir
  // da CREDENCIAL, que é a única origem admissível do tenant (M11 DoD #1 + M12 DoD #3).
  if (opts.authVerifier !== undefined) {
    app.use('*', createAuthMiddleware({ verifier: opts.authVerifier, authRequired: true }));
  }

  const resolvePrincipal = opts.principalResolver ?? ((): Principal => DEFAULT_PRINCIPAL);
  app.use('*', async (c, next) => {
    // Já autenticado pelo middleware acima: não sobrescrever o Principal da credencial.
    if (opts.authVerifier !== undefined) {
      await next();
      return;
    }
    // O middleware `*` do Hono entrega um Context com path genérico; o resolver declara o
    // Context tipado do app. São o mesmo objeto em runtime — o estreitamento explícito evita
    // que a diferença de assinatura vire `any` implícito.
    c.set('principal', resolvePrincipal(c as unknown as Context<AppEnv>));
    await next();
  });

  registerSkillsRoutes(app, {
    skillsStoreFor: (ws: string) => createSkillsStore(db, ws),
    revisionsStoreFor: (ws: string) => createRevisionsStore(db, ws),
    operationsStoreFor: (ws: string) => createOperationsStore(db, ws),
    queue: opts.queue,
    payloadValidator: opts.payloadValidator ?? createYauzlPayloadValidator(),
    secretScanner: opts.secretScanner ?? createSecretlintScanner(),
    logger,
    reservationHours: opts.reservationHours ?? envReservationHours(),
    maxBodyBytes: opts.maxBodyBytes ?? envMaxBodyBytes(),
  });
  registerOperationsRoutes(app, { operationsStoreFor: (ws: string) => createOperationsStore(db, ws) });
  registerWebhookEndpointRoutes(app, {
    endpointsStoreFor: (ws: string) => createWebhookEndpointsStore(db, ws),
    logger,
    ...(opts.dnsResolver !== undefined ? { dnsResolver: opts.dnsResolver } : {}),
  });
  // Retriever POR WORKSPACE, como os stores acima — não um singleton de boot.
  //
  // O executor e o embedder continuam sendo criados uma vez (são caros e sem estado de
  // tenant); o que se cria por requisição é o closure que fixa o workspace. Montar o
  // dispatcher uma única vez no boot foi exatamente o que deixou a rota de descoberta
  // servindo o catálogo inteiro a qualquer tenant.
  const retrieveExecutor = createPgExecutor(opts.pool);
  const retrieveEmbedder = opts.embedder ?? selectEmbedder();
  registerRetrieveRoutes(app, {
    retrieverFor: (ws: string) =>
      createDispatchingRetriever({ executor: retrieveExecutor, embedder: retrieveEmbedder, workspaceId: ws }),
    logger,
  });

  return app;
}

function envReservationHours(): number {
  const raw = Number(process.env['THEOSKILL_ID_RESERVATION_HOURS'] ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESERVATION_HOURS;
}

function envMaxBodyBytes(): number {
  const raw = Number(process.env['THEOSKILL_MAX_BODY_BYTES'] ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BODY_BYTES;
}
