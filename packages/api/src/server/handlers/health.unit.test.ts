// Liveness and readiness are different questions (B-119, contract rule D5).
//
// # What was missing
//
// theo-skills served `/v1/health` and nothing else operational. Liveness alone answers "is the
// process up"; it cannot answer "can it serve". During a rolling deploy an instance whose
// dependencies have not resolved answers 200 on liveness, the orchestrator reads that as ready,
// and traffic lands on it.
//
// Measured across the ecosystem for the HTTP surface contract (B-115): nine services, nine
// different combinations. This repo had one of the two.
//
// # Why the liveness body grows a `service` field
//
// An operator reading health responses in an aggregated dashboard needs to know which service
// answered. A bare `{"status":"ok"}` is byte-identical to every other service's, so a panel
// showing eight of them shows eight rows that cannot be told apart. Additive: a consumer reading
// `status` is unaffected.

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { type AppEnv } from '../principal-context.js';
import { registerHealthRoutes } from './health.js';

function appWith(ready: () => Promise<Record<string, 'ok' | 'unavailable'>>) {
  const app = new Hono<AppEnv>();
  registerHealthRoutes(app, ready);
  return app;
}

const allWired = (): Promise<Record<string, 'ok' | 'unavailable'>> =>
  Promise.resolve({ database: 'ok' });

describe('the operational surface', () => {
  it('test_liveness_answers_ok', async () => {
    const res = await appWith(allWired).request('/v1/health');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status?: string }).status).toBe('ok');
  });

  it('test_liveness_names_the_service', async () => {
    const body = (await (await appWith(allWired).request('/v1/health')).json()) as {
      service?: string;
    };
    expect(body.service, 'a health row that does not name its service is unreadable in a panel').toBe(
      'theo-skills',
    );
  });

  it('test_readiness_is_served', async () => {
    const res = await appWith(allWired).request('/v1/health/ready');
    expect(res.status).toBe(200);
  });

  it('test_readiness_names_what_it_checked', async () => {
    // A readiness endpoint that says "ready" without saying what it verified is an assertion, not
    // a check — and an operator reading a failure has nowhere to look.
    const body = (await (await appWith(allWired).request('/v1/health/ready')).json()) as {
      status?: string;
      checks?: Record<string, string>;
    };
    expect(body.status).toBe('ready');
    expect(Object.keys(body.checks ?? {}).length).toBeGreaterThan(0);
  });

  it('test_readiness_reports_degraded_when_a_dependency_is_down', async () => {
    // The case that makes the endpoint worth having. Without it, readiness is liveness wearing a
    // second URL, and the rolling deploy it exists to protect still sends traffic to an instance
    // that cannot serve.
    const degraded = (): Promise<Record<string, 'ok' | 'unavailable'>> =>
      Promise.resolve({ database: 'unavailable' });
    const res = await appWith(degraded).request('/v1/health/ready');
    const body = (await res.json()) as { status?: string; checks?: Record<string, string> };

    expect(res.status, 'a dependency is down; readiness must not answer 200').toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks?.['database']).toBe('unavailable');
  });

  it('test_liveness_stays_up_when_readiness_is_degraded', async () => {
    // The counterpart. Liveness answering 503 because a dependency is down makes the orchestrator
    // RESTART a healthy process, which loses in-flight work and does not fix the dependency.
    const degraded = (): Promise<Record<string, 'ok' | 'unavailable'>> =>
      Promise.resolve({ database: 'unavailable' });
    const res = await appWith(degraded).request('/v1/health');
    expect(res.status).toBe(200);
  });
});
