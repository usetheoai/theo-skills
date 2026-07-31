import { afterAll, beforeEach, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createMembersStore, LastOwnerError } from '../../src/server/store/members-store.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M13 DoD #3 — o invariante de último dono, sob CONCORRÊNCIA REAL.
 *
 * O roadmap é explícito sobre por que este teste é de integração e não unitário: "corrida no
 * last-owner só aparece sob concorrência real". Um mock de transação sempre serializa, então
 * um teste unitário aprovaria a implementação sem `FOR UPDATE` — que é justamente a que
 * deixa o workspace órfão em produção.
 *
 * "Órfão" aqui é terminal: sem nenhum `owner`, ninguém pode promover ninguém, porque promover
 * exige ser owner. Não há caminho de volta pela API.
 */

const WS = 'ws_owners';

describeIntegration('M13 — last-owner invariant sob concorrência', () => {
  const store = () => createMembersStore(createDb(getPool()), WS);

  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    for (const [id, email] of [
      ['u_a', 'a@x.dev'],
      ['u_b', 'b@x.dev'],
      ['u_c', 'c@x.dev'],
    ]) {
      await pool.query('INSERT INTO users (user_id, email) VALUES ($1,$2)', [id, email]);
    }
  });

  afterAll(closePool);

  it('demover o ÚNICO owner falha com LastOwnerError', async () => {
    const s = store();
    await s.upsert('u_a', 'owner');
    await s.upsert('u_b', 'member');
    await expect(s.changeRole('u_a', 'member')).rejects.toBeInstanceOf(LastOwnerError);
    expect(await s.roleOf('u_a')).toBe('owner');
  });

  it('remover o ÚNICO owner falha — órfão por remoção é igual a órfão por demoção', async () => {
    const s = store();
    await s.upsert('u_a', 'owner');
    await expect(s.remove('u_a')).rejects.toBeInstanceOf(LastOwnerError);
    expect(await s.roleOf('u_a')).toBe('owner');
  });

  it('demover UM de DOIS owners é permitido', async () => {
    // Contraprova: um invariante que recusasse toda demoção também passaria nos testes acima.
    const s = store();
    await s.upsert('u_a', 'owner');
    await s.upsert('u_b', 'owner');
    await s.changeRole('u_a', 'member');
    expect(await s.roleOf('u_a')).toBe('member');
    expect(await s.roleOf('u_b')).toBe('owner');
  });

  it('CORRIDA: duas demoções simultâneas sobre dois owners deixam exatamente UM owner', async () => {
    // O teste que justifica o `FOR UPDATE`. Sem o lock, ambas as transações leem "2 owners",
    // ambas concluem que podem prosseguir, e o workspace termina com ZERO.
    const s = store();
    await s.upsert('u_a', 'owner');
    await s.upsert('u_b', 'owner');

    const results = await Promise.allSettled([s.changeRole('u_a', 'member'), s.changeRole('u_b', 'member')]);

    const membros = await s.list();
    const owners = membros.filter((m) => m.role === 'owner');
    expect(
      owners.length,
      `owners restantes=${String(owners.length)} — resultados: ${results.map((r) => r.status).join(',')}`,
    ).toBe(1);

    // Exatamente uma das duas precisa ter sido recusada, e com o erro tipado.
    const rejeitadas = results.filter((r) => r.status === 'rejected');
    expect(rejeitadas).toHaveLength(1);
    expect((rejeitadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(LastOwnerError);
  });

  it('CORRIDA de três: duas recusadas, um owner sobrevive', async () => {
    const s = store();
    await s.upsert('u_a', 'owner');
    await s.upsert('u_b', 'owner');
    await s.upsert('u_c', 'owner');

    const results = await Promise.allSettled([
      s.changeRole('u_a', 'member'),
      s.changeRole('u_b', 'member'),
      s.changeRole('u_c', 'member'),
    ]);
    const owners = (await s.list()).filter((m) => m.role === 'owner');
    expect(owners.length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('DEFAULT-DENY: usuário sem membership resolve para null, nunca para um papel', async () => {
    // M13 DoD #1 — a ausência de membership não pode virar acesso por omissão.
    expect(await store().roleOf('u_desconhecido')).toBeNull();
  });

  it('o store é escopado: membership de outro workspace não vaza', async () => {
    const a = createMembersStore(createDb(getPool()), 'ws_A');
    const b = createMembersStore(createDb(getPool()), 'ws_B');
    await a.upsert('u_a', 'owner');
    expect(await b.roleOf('u_a')).toBeNull();
    expect(await b.list()).toEqual([]);
  });
});
