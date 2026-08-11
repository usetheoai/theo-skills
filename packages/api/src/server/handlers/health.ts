import { type Hono } from 'hono';

import { type AppEnv } from '../principal-context.js';

/**
 * The operational surface: liveness and readiness (B-119, contract rule D5).
 *
 * # Why two routes and not one
 *
 * Liveness answers "is the process up". Readiness answers "can it serve". Collapsing them means
 * that during a rolling deploy an instance whose dependencies have not resolved answers 200, the
 * orchestrator reads that as ready, and traffic lands on it.
 *
 * The inverse matters just as much and is easier to get wrong: liveness must NOT fail when a
 * dependency is down. A 503 on liveness makes the orchestrator restart a healthy process — which
 * loses in-flight work and does not fix the dependency.
 *
 * # Why readiness answers 503 while theo-trust's answers 200
 *
 * Not an inconsistency: the two services degrade differently. theo-trust keeps its guard path
 * servable when a secondary read surface is absent, so taking it out of rotation would cost more
 * than it protects. theo-skills has no such core path — its dependencies are the service. When
 * they are down there is nothing left to serve, and staying in rotation only produces failed
 * requests that look like the service's fault.
 */
export type ReadinessProbe = () => Promise<Record<string, 'ok' | 'unavailable'>>;

const SERVICE = 'theo-skills';

export function registerHealthRoutes(app: Hono<AppEnv>, probe?: ReadinessProbe): void {
  // `service` is additive: a consumer reading `status` is unaffected. It exists because an
  // operator looking at an aggregated panel gets eight identical `{"status":"ok"}` rows otherwise,
  // with no way to tell which service each one came from.
  app.get('/v1/health', (c) => c.json({ status: 'ok', service: SERVICE }, 200));

  app.get('/v1/health/ready', async (c) => {
    // Without a probe the service can only honestly report that it is up. Claiming `ready` would
    // be an assertion about dependencies nobody looked at — the exact failure this endpoint is
    // supposed to remove.
    const checks = probe === undefined ? {} : await probe();
    const ready = Object.values(checks).every((v) => v === 'ok');
    return c.json(
      { status: ready ? 'ready' : 'degraded', service: SERVICE, checks },
      ready ? 200 : 503,
    );
  });
}
