import { type Hono } from 'hono';

import { type AppEnv, workspaceOf } from '../principal-context.js';
import { type OperationsStore } from '../store/operations-store.js';

export interface OperationsRoutesDeps {
  readonly operationsStoreFor: (workspaceId: string) => OperationsStore;
}

export function registerOperationsRoutes(app: Hono<AppEnv>, deps: OperationsRoutesDeps): void {
  // GET /v1/operations/:id
  app.get('/v1/operations/:id', async (c) => {
    const operation = await deps.operationsStoreFor(workspaceOf(c)).get(c.req.param('id'));
    if (operation === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(operation, 200);
  });
}
