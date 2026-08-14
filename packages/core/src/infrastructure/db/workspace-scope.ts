/**
 * Workspace scope — the request-bound tenant context that Row Level Security reads.
 *
 * WHY THIS EXISTS. Until 2026-08-14 the only thing separating one tenant's
 * skills, bundles and revisions from another's was the `workspace_id = $n`
 * predicate written by hand in every query. There was no database-level barrier:
 * a single missing predicate returned another workspace's rows with no error,
 * no log line and no failing test. The audit of the engine found exactly that
 * shape of defect, and this layer is what makes it structurally impossible here.
 *
 * The scope is bound once per request (see `withWorkspaceScope`) and read by
 * `tenantScopedPool` when it hands out a connection. Data-access code does not
 * change: it keeps receiving "a Pool" and keeps writing its usual predicates.
 * The difference is that the database now enforces the boundary underneath.
 *
 * AsyncLocalStorage is already the established mechanism for cross-tool
 * isolation in this repository (the sibling theo-memory package);
 * this applies the same pattern one layer down.
 *
 * @see migrations/0027_rls_fail_closed.sql — the policies this context satisfies
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** What a scoped unit of work knows about its tenant. */
export interface WorkspaceScope {
  /** The workspace every statement in this scope is confined to. */
  readonly workspaceId: string;
}

/**
 * A unit of work that deliberately spans every workspace — migrations, health
 * probes, platform-wide maintenance. Kept as a distinct, named state so that
 * "no tenant" is always an explicit decision rather than an omission.
 */
export interface CrossWorkspaceScope {
  readonly crossWorkspace: true;
  /** Why this work legitimately spans tenants. Surfaces in errors and traces. */
  readonly reason: string;
}

type Scope = WorkspaceScope | CrossWorkspaceScope;

const STORE = new AsyncLocalStorage<Scope>();

/** Type guard: does this scope deliberately span workspaces? */
export function isCrossWorkspace(scope: Scope): scope is CrossWorkspaceScope {
  return 'crossWorkspace' in scope;
}

/**
 * Runs `fn` with every database statement confined to `workspaceId`.
 *
 * Bind this once per request, immediately after the principal is resolved, and
 * pass the principal's workspace — never a value from the body or the path,
 * which the caller controls.
 */
export function withWorkspaceScope<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const trimmed = workspaceId?.trim();
  if (!trimmed) {
    // An empty workspace would satisfy no policy and read nothing, turning a
    // wiring bug into an empty result page. Refusing here names the real cause.
    throw new WorkspaceScopeError(
      'withWorkspaceScope called with an empty workspaceId — ' +
        'resolve the principal before opening the scope.',
    );
  }
  return STORE.run({ workspaceId: trimmed }, fn);
}

/**
 * REFUSES. Kept as a signpost, not as a capability.
 *
 * This used to run `fn` with the scope marked cross-workspace, which made
 * `requireScopeValue` return the empty string, which the pool wrote into
 * `app.workspace_id`. The isolation policy compares the column against exactly that
 * value — so the "crossing" matched no row at all. Callers got an empty result and no
 * error: the silent-nothing this mechanism exists to prevent, wearing the name of the
 * sanctioned escape hatch. It went unnoticed because its only caller ran as a
 * superuser, which bypasses row security outright.
 *
 * Under fail-closed RLS there is no in-process way to grant a real crossing. What
 * works is `withWorkspaceScope(id, fn)` per workspace — iterating a list taken from
 * outside the protected tables — or a policy that NAMES a role in `TO`, which is a
 * reviewable, revocable grant rather than a function call.
 */
export function withCrossWorkspaceScope<T>(reason: string, _fn: () => Promise<T>): Promise<T> {
  return Promise.reject(
    new WorkspaceScopeError(
      `withCrossWorkspaceScope(${JSON.stringify(reason)}) does not grant a crossing and never ` +
        'did: it set the workspace context to the empty string, which the isolation policy ' +
        'matches against nothing, so every statement inside returned zero rows without error. ' +
        'Use withWorkspaceScope(id, fn) once per workspace — taking the list from outside the ' +
        'protected tables — or add a policy that names a role in TO, which is a reviewable and ' +
        'revocable grant instead of a silent one.',
    ),
  );
}

/** The active scope, or `undefined` outside any scope. */
export function currentScope(): Scope | undefined {
  return STORE.getStore();
}

/**
 * Raised when data access is attempted with no tenant context established.
 *
 * Deliberately an exception rather than a silent fallback. Under fail-closed
 * RLS, a statement with no context matches no rows — and "zero rows" is
 * ambiguous: it reads exactly like "this tenant has no data". Throwing turns a
 * missing-scope bug into a loud failure at the call site that caused it,
 * instead of an empty list somewhere downstream.
 */
export class WorkspaceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceScopeError';
  }
}

/**
 * The value to hand PostgreSQL for `app.workspace_id`, or throws when no scope
 * is active.
 *
 * Cross-workspace scopes resolve to the empty string; the policies never admit
 * it, so such work must additionally run under a role holding the
 * `*_maintenance` policy. Two independent conditions have to be met before
 * anything reads across tenants, and neither is the default.
 */
export function requireScopeValue(operation: string): string {
  const scope = currentScope();
  if (!scope) {
    throw new WorkspaceScopeError(
      `${operation} attempted with no workspace scope. Every request must run inside ` +
        'withWorkspaceScope(principal.workspaceId, …); genuinely tenant-spanning work ' +
        'must declare itself via withCrossWorkspaceScope(reason, …).',
    );
  }
  if (isCrossWorkspace(scope)) {
    // Unreachable through withCrossWorkspaceScope, which now refuses — but a scope
    // built any other way must not reach the pool either. The empty string is not
    // "all workspaces": the policy compares against it literally and matches nothing.
    throw new WorkspaceScopeError(
      `${operation} attempted under a cross-workspace scope, which grants no access. ` +
        'Iterate with withWorkspaceScope(id, fn) instead.',
    );
  }
  return scope.workspaceId;
}
