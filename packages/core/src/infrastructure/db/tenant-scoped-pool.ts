/**
 * Tenant-scoped pool — where the request's workspace meets the connection.
 *
 * Wraps a `pg.Pool` so that every connection it hands out has already had
 * `app.workspace_id` set from the ambient scope. The fail-closed RLS policies
 * installed by migration 0016 read that setting, so a statement can only touch
 * rows belonging to the workspace the request was authenticated for.
 *
 * WHY A WRAPPER AND NOT A CHANGED CALL SITE. Tenant-scoped statements are spread
 * across the whole data layer of this package. Threading a
 * workspace argument through all of them would put the guarantee back where it
 * already failed once: on the discipline of remembering, in every file, forever.
 * The wrapper moves it to the one place a statement cannot avoid — acquiring a
 * connection. Data-access code keeps receiving "a Pool" and does not change.
 *
 * ORDER OF DEFENCE, weakest to strongest:
 *   1. the `workspace_id = $n` predicates the code already writes
 *   2. this wrapper, which sets the context on every connection
 *   3. the database policies, which admit nothing without that context
 *
 * Each layer is independent. Any one of them alone would have prevented the
 * 2026-08-14 exposure; the code shipped with only the first.
 *
 * @see workspace-scope.ts       — how the context is bound per request
 * @see migrations/0016_rls_fail_closed.sql — the policies being satisfied
 */
import type { Pool, PoolClient, QueryResult } from 'pg';

import { currentScope, isCrossWorkspace, requireScopeValue } from './workspace-scope.js';

/** The GUC the policies read. Must match the migration. */
const SCOPE_SETTING = 'app.workspace_id';

/**
 * Applies the ambient scope to a freshly acquired connection.
 *
 * Uses `set_config(..., false)` — session scope rather than transaction scope —
 * because most call sites here issue standalone statements rather than opening
 * a transaction. That makes resetting on release load-bearing rather than
 * cosmetic: see `releaseWithReset`.
 */
async function applyScope(client: PoolClient, operation: string): Promise<void> {
  const value = requireScopeValue(operation);
  await client.query({
    text: `SELECT set_config($1, $2, false)`,
    values: [SCOPE_SETTING, value],
  });
}

/**
 * Clears the context before the connection returns to the pool.
 *
 * Without this, a connection would carry one tenant's workspace into whatever
 * borrows it next. Every acquisition overwrites the value, so this is the
 * second of two independent guards against that — kept because the cost is one
 * statement and the failure it prevents is the exact class of bug this whole
 * change exists to remove.
 */
function releaseWithReset(client: PoolClient): PoolClient {
  const originalRelease = client.release.bind(client);
  let released = false;

  client.release = (err?: Error | boolean) => {
    if (released) return;
    released = true;

    if (err !== undefined && err !== false) {
      // A connection released with an error is destroyed, not reused — and
      // issuing another statement on it would throw over the real failure.
      originalRelease(err === true ? true : err);
      return;
    }

    void client
      .query({ text: `SELECT set_config($1, '', false)`, values: [SCOPE_SETTING] })
      .then(
        () => originalRelease(),
        // If the reset fails the connection is suspect: discard it rather than
        // return a connection whose tenant context is unknown.
        (resetErr: Error) => originalRelease(resetErr),
      );
  };

  return client;
}

/** Acquires a connection with the ambient workspace context already applied. */
async function scopedConnect(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await applyScope(client, 'pool.connect()');
  } catch (err) {
    client.release();
    throw err;
  }
  return releaseWithReset(client);
}

/**
 * Wraps `pool` so every connection carries the ambient workspace context.
 *
 * Throws `WorkspaceScopeError` when used outside a scope — see
 * `workspace-scope.ts` for why that is an exception rather than a fallback.
 */
export function tenantScopedPool(pool: Pool): Pool {
  const handler: ProxyHandler<Pool> = {
    get(target, prop, receiver) {
      if (prop === 'connect') {
        return () => scopedConnect(target);
      }

      if (prop === 'query') {
        // Route through the scoped connect() so the statement runs on a
        // connection whose context is already set — pool.query() would otherwise
        // borrow an arbitrary connection with no context at all.
        // `Pool['query']` is overloaded (promise form and legacy callback form),
        // so forwarding its parameter tuple verbatim resolves to the callback
        // overload — whose return is void, not a promise. Narrowing to the
        // promise form is what makes the release-in-finally correct.
        const scopedQuery = (...args: readonly unknown[]) =>
          scopedConnect(target).then(async (client) => {
            const run = client.query.bind(client) as (
              ...a: readonly unknown[]
            ) => Promise<QueryResult>;
            try {
              return await run(...args);
            } finally {
              client.release();
            }
          });
        return scopedQuery;
      }

      return Reflect.get(target, prop, receiver) as unknown;
    },
  };

  return new Proxy(pool, handler);
}

/**
 * Describes the active scope for logs and error messages.
 *
 * Never returns the workspace id itself: this string reaches logs, and a tenant
 * identifier in a shared log stream is the kind of leak that is trivial to add
 * and awkward to walk back.
 */
export function describeScope(): string {
  const scope = currentScope();
  if (!scope) return 'no scope';
  return isCrossWorkspace(scope) ? `cross-workspace (${scope.reason})` : 'workspace-scoped';
}
