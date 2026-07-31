import { describe, expect, it } from 'vitest';

import { createBootstrapVerifier, generateBootstrapToken } from '../../src/server/auth/bootstrap-token.js';

/** M12 DoD #1 — a credencial de primeiro acesso, e os três jeitos dela ficar aberta. */
describe('createBootstrapVerifier', () => {
  // Fixture curta e sem entropia — ver nota em `api-key-verifier.contract.test.ts`.
  const TOKEN = 'boot-fixture-sem-entropia';

  it('aceita o token configurado e resolve como admin do workspace declarado', async () => {
    const v = createBootstrapVerifier({ token: TOKEN, workspaceId: 'ws_boot' });
    expect(await v.resolvePrincipal(TOKEN)).toEqual({
      workspaceId: 'ws_boot',
      userId: 'bootstrap',
      role: 'owner',
      scopes: ['skills:admin'],
    });
  });

  it('é de USO ÚNICO — a segunda tentativa com o mesmo token falha', async () => {
    // Um bootstrap reutilizável é chave-mestra permanente numa variável de ambiente.
    const v = createBootstrapVerifier({ token: TOKEN, workspaceId: 'ws' });
    expect(await v.resolvePrincipal(TOKEN)).not.toBeNull();
    expect(await v.resolvePrincipal(TOKEN)).toBeNull();
    expect(v.isArmed()).toBe(false);
  });

  it('token ERRADO não consome o bootstrap', async () => {
    // Se um palpite errado desarmasse, qualquer um faria DoS no primeiro acesso do operador.
    const v = createBootstrapVerifier({ token: TOKEN, workspaceId: 'ws' });
    expect(await v.resolvePrincipal('palpite')).toBeNull();
    expect(v.isArmed()).toBe(true);
    expect(await v.resolvePrincipal(TOKEN)).not.toBeNull();
  });

  it('FAIL-CLOSED quando não configurado — nem o token vazio entra', async () => {
    for (const cfg of [undefined, '']) {
      const v = createBootstrapVerifier({ token: cfg, workspaceId: 'ws' });
      expect(v.isArmed()).toBe(false);
      expect(await v.resolvePrincipal('')).toBeNull();
      expect(await v.resolvePrincipal('qualquer')).toBeNull();
    }
  });

  it('duas requisições concorrentes: apenas UMA consome', async () => {
    const v = createBootstrapVerifier({ token: TOKEN, workspaceId: 'ws' });
    const [a, b] = await Promise.all([v.resolvePrincipal(TOKEN), v.resolvePrincipal(TOKEN)]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
  });

  it('generateBootstrapToken produz 256 bits de entropia e valores distintos', () => {
    const a = generateBootstrapToken();
    const b = generateBootstrapToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^theoskill_boot_[0-9a-f]{64}$/);
  });
});
