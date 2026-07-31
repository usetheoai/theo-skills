import { createSecretlintScanner, createYauzlPayloadValidator } from '@usetheo/skills/validators';
import { describe, expect, it, vi } from 'vitest';
import yazl from 'yazl';

import { type ParsedCli } from '../../src/args.js';
import { runPublish } from '../../src/commands/publish.js';

const validation = { payloadValidator: createYauzlPayloadValidator(), secretScanner: createSecretlintScanner() };

function zip(content: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    z.addBuffer(Buffer.from(content, 'utf8'), 'SKILL.md');
    z.end();
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
const valid = () => zip(`---\nname: my-skill\ndescription: a useful skill\n---\n# my-skill\n`);
const args = (): ParsedCli => ({ command: 'publish', path: 'skill', registry: 'http://reg.test/', skillId: 'my-skill' });
const capture = () => {
  const lines: string[] = [];
  return { out: (l: string) => lines.push(l), lines };
};
const jsonRes = (status: number, body: unknown) =>
  ({ status, json: () => Promise.resolve(body) }) as unknown as Response;

describe('runPublish', () => {
  it('POSTs a new skill (GET 404 → POST 202) with the correct body, prints the operation id', async () => {
    const buf = await valid();
    let postBody: { skill_id?: string; zippedFilesystem?: string } | undefined;
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === undefined || init.method === 'GET') return Promise.resolve(jsonRes(404, {}));
      postBody = JSON.parse(init.body as string) as typeof postBody;
      return Promise.resolve(jsonRes(202, { operation_id: 'op_123' }));
    }) as unknown as typeof globalThis.fetch;
    const { out, lines } = capture();
    const code = await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/published.*created.*op_123/);
    expect(postBody).toEqual({ skill_id: 'my-skill', zippedFilesystem: buf.toString('base64') }); // body shape
  });

  it('PATCH body carries only zippedFilesystem + updateMask (no skill_id)', async () => {
    const buf = await valid();
    let patchUrl: string | undefined;
    let patchBody: Record<string, unknown> | undefined;
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === undefined || init.method === 'GET') return Promise.resolve(jsonRes(200, { skill_id: 'my-skill' }));
      patchUrl = url;
      patchBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(jsonRes(202, { operation_id: 'op_p' }));
    }) as unknown as typeof globalThis.fetch;
    const { out } = capture();
    await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(patchUrl).toContain('updateMask=zippedFilesystem');
    expect(patchBody).toEqual({ zippedFilesystem: buf.toString('base64') });
    expect(patchBody).not.toHaveProperty('skill_id');
  });

  it('falls back to PATCH when POST races a concurrent create (409 → update)', async () => {
    const buf = await valid();
    const methods: string[] = [];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const m = init?.method ?? 'GET';
      methods.push(m);
      if (m === 'GET') return Promise.resolve(jsonRes(404, {})); // looked absent...
      if (m === 'POST') return Promise.resolve(jsonRes(409, { error: 'already_exists' })); // ...but created in between
      return Promise.resolve(jsonRes(202, { operation_id: 'op_race' })); // PATCH succeeds
    }) as unknown as typeof globalThis.fetch;
    const { out, lines } = capture();
    const code = await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(code).toBe(0);
    expect(methods).toEqual(['GET', 'POST', 'PATCH']);
    expect(lines.join('\n')).toMatch(/updated.*op_race/);
  });

  it('returns 1 with a clear message on a non-202 registry response', async () => {
    const buf = await valid();
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === undefined || init.method === 'GET') return Promise.resolve(jsonRes(404, {}));
      return Promise.resolve(jsonRes(400, { error: 'invalid_zip' }));
    }) as unknown as typeof globalThis.fetch;
    const { out, lines } = capture();
    const code = await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/registry rejected.*HTTP 400.*invalid_zip/);
  });

  it('PATCHes an existing skill (GET 200 → PATCH 202)', async () => {
    const buf = await valid();
    const calls: string[] = [];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === undefined || init.method === 'GET') return Promise.resolve(jsonRes(200, { skill_id: 'my-skill' }));
      return Promise.resolve(jsonRes(202, { operation_id: 'op_456' }));
    }) as unknown as typeof globalThis.fetch;
    const { out, lines } = capture();
    const code = await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/updated.*op_456/);
    expect(calls.some((c) => c.startsWith('PATCH'))).toBe(true);
  });

  it('does NOT publish an invalid skill (returns 1, no POST)', async () => {
    const buf = await zip(`---\nname: Invalid Name\ndescription: x\n---\n# x\n`);
    const fetch = vi.fn(() => Promise.resolve(jsonRes(202, {}))) as unknown as typeof globalThis.fetch;
    const { out, lines } = capture();
    const code = await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('[schema_invalid]');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 2 with a clear message when the registry is unreachable', async () => {
    const buf = await valid();
    const fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch;
    const { out, lines } = capture();
    const code = await runPublish(args(), { validation, out, fetch, package: () => Promise.resolve(buf) });
    expect(code).toBe(2);
    expect(lines.join('\n')).toMatch(/could not reach the registry/);
  });

  it('returns 2 when required flags are missing', async () => {
    const { out } = capture();
    expect(await runPublish({ command: 'publish', path: 'skill' }, { validation, out, fetch: globalThis.fetch })).toBe(2);
  });
});
