import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

const fakePool = {} as unknown as Pool;
const fakeQueue = {} as unknown as PgBoss;

function app() {
  return createApp({ pool: fakePool, queue: fakeQueue, logger: createNoopLogger() });
}

const ENV_KEYS = ['THEOSKILL_VERSION', 'THEOSKILL_GIT_SHA', 'THEOSKILL_BUILD_TIME'] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('GET /v1/version', () => {
  it('responde sem credencial', async () => {
    // Um endpoint de versão existe para o chamador distinguir serviço FORA DO AR de
    // serviço saudável. Atrás de credencial, "está caído" e "minha chave está errada"
    // produzem a mesma resposta, e o agregador não consegue separar os dois.
    const res = await app().request('/v1/version');
    expect(res.status).toBe(200);
  });

  it('devolve os campos que o agregador do /status consome', async () => {
    process.env['THEOSKILL_VERSION'] = '1.2.3';
    process.env['THEOSKILL_GIT_SHA'] = 'abc1234';
    process.env['THEOSKILL_BUILD_TIME'] = '2026-07-30T18:00:00Z';

    const body = (await (await app().request('/v1/version')).json()) as Record<string, string>;

    expect(body['name']).toBe('@usetheo/skills-api');
    expect(body['version']).toBe('1.2.3');
    expect(body['git_sha']).toBe('abc1234');
    expect(body['built_at']).toBe('2026-07-30T18:00:00Z');
    expect(body['node']).toBe(process.version);
  });

  it('usa fallbacks explícitos quando o build não injetou as variáveis', async () => {
    // Os fallbacks são CONTRATO, não enfeite defensivo. Quem agrega versões precisa
    // distinguir "respondeu mas não sabe o que é" de "respondeu com versão real".
    // String vazia, ou campo omitido, colapsa os dois casos — e quem lê a saída conclui
    // que a requisição falhou, quando na verdade ela funcionou.
    const body = (await (await app().request('/v1/version')).json()) as Record<string, string>;

    expect(body['version']).toBe('dev');
    expect(body['git_sha']).toBe('unknown');
    expect(body['built_at']).toBe('unknown');
  });
});
