import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const API = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * O GATE DE INTEGRAÇÃO PRECISA MEDIR ALGO — ou falhar dizendo que não mediu.
 *
 * Medido em 2026-08-01: sem `THEOSKILL_PG_URI`, a suíte de integração reportava
 * `47 skipped (47) / 240 skipped (240)` e **saía com código 0**. Um runner de CI sem a
 * variável — ou com o nome errado dela — reporta SUCESSO sobre cobertura zero.
 *
 * É o pior formato de falha deste repositório: não há erro, não há log, e o portão fica
 * verde sobre nada. A intenção original (deixar rodar local sem banco) é legítima — mas
 * precisa ser um opt-out **explícito**, nunca o default silencioso.
 */
describe('a suíte de integração não pode ficar verde sem medir nada', () => {
  const rodar = async (env: Record<string, string>): Promise<{ code: number; saida: string }> => {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [join(API, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.integration.config.ts'],
        { cwd: API, env: { ...process.env, THEOSKILL_PG_URI: '', DATABASE_URL: '', ...env }, timeout: 120_000 },
      );
      return { code: 0, saida: stdout + stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, saida: (e.stdout ?? '') + (e.stderr ?? '') };
    }
  };

  it('sem banco e sem opt-out: FALHA, e diz por quê', async () => {
    const { code, saida } = await rodar({});
    expect(code, 'exit ≠ 0 — verde sobre zero teste é pior que vermelho').not.toBe(0);
    expect(saida).toContain('THEOSKILL_PG_URI');
  }, 150_000);

  it('sem banco COM opt-out explícito: pula, e sai 0', async () => {
    // Quem roda local sem Postgres continua atendido — mas precisa dizer que quer isso.
    const { code, saida } = await rodar({ THEOSKILL_SKIP_INTEGRATION: '1' });
    expect(code).toBe(0);
    expect(saida).toMatch(/skipped/i);
  }, 150_000);
});
