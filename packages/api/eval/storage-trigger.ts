/**
 * Mede os números que o ADR 0005 declarou como GATILHO para migrar o payload do Postgres
 * para object storage (M21 DoD #4).
 *
 * Existe como script, e não como teste, porque a resposta muda com o acervo: um número
 * medido hoje envelhece com o catálogo, e a decisão precisa ser revisitada com o dado do
 * momento — não com uma constante escrita num commit antigo.
 *
 * Uso:  THEOSKILL_PG_URI=... pnpm -C packages/api eval:storage
 */
import { Pool } from 'pg';

/** Gatilhos declarados no ADR 0005. */
const P90_TRIGGER_BYTES = 10 * 1024 * 1024; // 10 MB

async function main(): Promise<void> {
  const uri = process.env['THEOSKILL_PG_URI'];
  if (uri === undefined || uri === '') {
    process.stderr.write('THEOSKILL_PG_URI é obrigatório — a medição roda contra o banco real.\n');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: uri });
  try {
    const { rows } = await pool.query<{
      revisoes: string;
      p90_bytes: string;
      max_bytes: string;
      total_bytes: string;
    }>(`
      SELECT count(*)::text AS revisoes,
             coalesce(percentile_disc(0.9) WITHIN GROUP (ORDER BY octet_length(payload)), 0)::text AS p90_bytes,
             coalesce(max(octet_length(payload)), 0)::text AS max_bytes,
             coalesce(sum(octet_length(payload)), 0)::text AS total_bytes
      FROM skill_revisions
    `);
    const r = rows[0];
    if (r === undefined || r.revisoes === '0') {
      // Fail-honest: sem acervo não há número. Inventar uma projeção aqui seria exatamente a
      // "estimativa apresentada como medição" que o ADR proíbe.
      process.stdout.write('\nSem revisões no banco — nada a medir.\n');
      process.stdout.write('O gatilho de object storage só pode ser avaliado com acervo real.\n');
      return;
    }

    const inst = await pool.query<{ n: string; dias: string }>(`
      SELECT count(*)::text AS n,
             greatest(1, extract(epoch FROM (now() - min(create_time))) / 86400)::text AS dias
      FROM install_events
    `);
    const eventos = Number(inst.rows[0]?.n ?? 0);
    const dias = Number(inst.rows[0]?.dias ?? 1);
    const p90 = Number(r.p90_bytes);
    const mediaBytes = Number(r.total_bytes) / Number(r.revisoes);

    process.stdout.write(`\nGatilho de object storage (ADR 0005)\n\n`);
    process.stdout.write(`revisões no acervo : ${r.revisoes}\n`);
    process.stdout.write(`p90 do payload     : ${(p90 / 1024).toFixed(1)} KB\n`);
    process.stdout.write(`maior payload      : ${(Number(r.max_bytes) / 1024).toFixed(1)} KB\n`);
    process.stdout.write(`acervo total       : ${(Number(r.total_bytes) / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`instalações/dia    : ${(eventos / dias).toFixed(1)} (janela de ${dias.toFixed(1)} dias)\n`);
    process.stdout.write(`bytes servidos/dia : ${((eventos / dias) * mediaBytes / 1024 / 1024).toFixed(2)} MB (estimado pela média do payload)\n\n`);

    const estourou = p90 > P90_TRIGGER_BYTES;
    process.stdout.write(`gatilho p90 > 10 MB: ${estourou ? 'ATINGIDO — abrir ADR de migração' : 'não atingido'}\n`);
    if (estourou) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
