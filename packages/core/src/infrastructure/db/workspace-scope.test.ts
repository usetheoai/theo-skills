/**
 * `withCrossWorkspaceScope` refuses, loudly, instead of quietly granting nothing.
 *
 * THE DEFECT THIS PINS. The helper read as the sanctioned way to do tenant-spanning
 * work. Its implementation set `app.workspace_id` to the empty string, and the
 * isolation policy compares the column against exactly that value — so the "crossing"
 * matched no row at all. Callers got an empty result and no error: the same
 * silent-nothing this mechanism exists to prevent, wearing the name of the escape
 * hatch.
 *
 * It went unnoticed because its only caller was a test-database reset running as the
 * container's superuser, which bypasses row security entirely. Green for a reason
 * that does not exist in production.
 *
 * A name that announces a bypass and delivers a filtered-to-nothing query is a trap
 * for whoever reads it next. Under fail-closed RLS there is no in-process way to
 * grant a real crossing: it would take either a policy naming a role, or the caller
 * iterating workspace by workspace with `withWorkspaceScope`. Both are decisions made
 * elsewhere, on purpose. So the helper stays as a signpost and refuses.
 */
import { describe, expect, it } from 'vitest';

import {
  WorkspaceScopeError,
  currentScope,
  withCrossWorkspaceScope,
  withWorkspaceScope,
} from './workspace-scope.js';

describe('withCrossWorkspaceScope', () => {
  it('throws instead of running the callback', async () => {
    let ran = false;
    await expect(
      withCrossWorkspaceScope('platform maintenance', () => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    expect(ran, 'the callback must not run — it would read zero rows and report success').toBe(
      false,
    );
  });

  it('says why, and points at what actually works', async () => {
    // The message is the whole value of keeping the function: the next person to
    // reach for it learns why in the stack trace, not after debugging empty results.
    const attempt = withCrossWorkspaceScope('retention sweep', () => Promise.resolve(undefined));
    await expect(attempt).rejects.toThrow(/does not grant/i);
    await expect(attempt).rejects.toThrow(/withWorkspaceScope/);
  });

  it('leaves no scope behind when it refuses', async () => {
    await withCrossWorkspaceScope('anything', () => Promise.resolve(undefined)).catch(() => undefined);
    expect(currentScope(), 'a refused call must not leak a scope into the caller').toBeUndefined();
  });
});

describe('withWorkspaceScope', () => {
  it('still binds a real workspace, which is the supported path', async () => {
    const seen = await withWorkspaceScope('ws-a', () => Promise.resolve(currentScope()));
    expect(seen).toEqual({ workspaceId: 'ws-a' });
  });
});
