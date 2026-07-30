import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from './migrate.js';

const uri = process.env['THEOSKILL_PG_URI'] ?? '';
const describeIntegration = describe.skipIf(uri === '');

// Um BANCO descartável por execução, não um schema.
//
// A primeira versão deste teste isolava por `search_path` e falhou — as migrations qualificam
// `"public"."webhook_endpoints"` explicitamente, então a FK apontava para fora do schema
// isolado. O truque do search_path só funciona quando o DDL é agnóstico de schema, e este não é.
//
// O isolamento importa porque `runMigrations` precisa ser exercitado contra um banco VAZIO —
// a única condição em que o defeito aparece. Rodar contra o banco de teste já migrado provaria
// apenas que reaplicar não quebra, e foi exatamente essa a lacuna que deixou o serviço subir no
// dev host com ZERO tabelas, `/v1/health` em 200 e `/v1/skills` em 500.
const PROBE_DB = 'skills_migrate_probe';

const probeUri = (): string => {
  const u = new URL(uri);
  u.pathname = `/${PROBE_DB}`;
  return u.toString();
};

describeIntegration('runMigrations (schema autossuficiente na imagem)', () => {
  const admin = new Pool({ connectionString: uri });

  const recreateProbeDb = async (): Promise<void> => {
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${PROBE_DB}`);
  };

  beforeAll(recreateProbeDb);

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await admin.end();
  });

  it('cria o schema a partir de um banco vazio', async () => {
    const p = new Pool({ connectionString: probeUri() });
    try {
      await runMigrations(p);
      const res = await p.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tables = new Set(res.rows.map((r) => r.table_name));

      // As que o servidor toca no primeiro request. `skills` é a que devolvia 500.
      expect(tables).toContain('skills');
      expect(tables).toContain('skill_revisions');
      expect(tables).toContain('operations');
      expect(tables).toContain('webhook_deliveries');
    } finally {
      await p.end();
    }
  });

  it('é idempotente — reaplicar sobre um banco já migrado não falha', async () => {
    // O reconciliador recria o container a cada convergência; se a segunda aplicação
    // explodisse, o serviço entraria em crashloop no primeiro deploy subsequente.
    const p = new Pool({ connectionString: probeUri() });
    try {
      await expect(runMigrations(p)).resolves.toBeUndefined();
    } finally {
      await p.end();
    }
  });

  it('serializa aplicações concorrentes em vez de deixá-las colidir', async () => {
    // A M11 troca a CHAVE PRIMÁRIA de `skills`. Duas réplicas subindo juntas contra um banco
    // virgem aplicariam o mesmo DDL ao mesmo tempo; sem o advisory lock uma delas morre com
    // "tuple concurrently updated" ou "relation already exists" — e o container reinicia em
    // loop. O lock é o que torna migrate-no-boot seguro com N réplicas.
    await recreateProbeDb();

    const pools = [0, 1, 2].map(() => new Pool({ connectionString: probeUri() }));
    try {
      const results = await Promise.allSettled(pools.map((p) => runMigrations(p)));
      // Compara a LISTA DE MOTIVOS, não uma contagem: quando este teste reprova, a mensagem
      // já traz o erro do Postgres ("tuple concurrently updated", "relation already exists")
      // em vez de um `false !== true` que obriga a reproduzir à mão para descobrir o porquê.
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.map((r) => String(r.reason))).toEqual([]);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });
});
