import { type Hono } from 'hono';

import { type AppEnv } from '../principal-context.js';

/** Liveness probe. Cheap, dependency-free. */
export function registerHealthRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/health', (c) => c.json({ status: 'ok' }, 200));
}
