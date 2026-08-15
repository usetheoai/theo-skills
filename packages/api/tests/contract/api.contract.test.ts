import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

// Health + early input validation never touch DB/queue, so trivial fakes suffice.
const fakePool = {} as unknown as Pool;
const fakeQueue = { send: () => Promise.resolve('job') } as unknown as PgBoss;

function app() {
  return createApp({ pool: fakePool, queue: fakeQueue, logger: createNoopLogger() });
}

describe('API contract (no DB)', () => {
  it('GET /v1/health returns 200 and names the service', async () => {
    // B-119 — `service` joined the body. An operator reading health rows in an aggregated panel
    // gets eight byte-identical `{"status":"ok"}` responses otherwise, with no way to tell which
    // service each came from. Asserted by field rather than by whole-object equality so the next
    // additive field does not fail a contract it does not break.
    const res = await app().request('/v1/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status?: string; service?: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('theo-skills');
  });

  it('GET /v1/health/ready is a different answer from liveness', async () => {
    // Liveness says the process is up; readiness says it can serve. Without this route a rolling
    // deploy sends traffic to an instance whose dependencies have not resolved — the process
    // answers, so the orchestrator believes it is ready.
    const res = await app().request('/v1/health/ready');
    const body = (await res.json()) as { status?: string; checks?: Record<string, string> };

    expect(body.status === 'ready' || body.status === 'degraded').toBe(true);
    expect(body.checks, 'readiness that does not name what it checked is an assertion').toBeDefined();
  });

  it('POST /v1/skills with reserved gcp- prefix returns 400 invalid_skill_id (before any DB call)', async () => {
    const res = await app().request('/v1/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: 'gcp-x', zippedFilesystem: 'AAAA' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_skill_id' });
  });

  it('POST /v1/skills with missing skill_id returns 400', async () => {
    const res = await app().request('/v1/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zippedFilesystem: 'AAAA' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/skills with non-JSON body returns 400 invalid_input', async () => {
    const res = await app().request('/v1/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_input' });
  });
});
