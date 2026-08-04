import { createId } from '@paralleldrive/cuid2';
import { createStubEmbedder, stubEmbed, type Principal } from '@usetheo/skills';
import type PgBoss from 'pg-boss';
import { afterAll, beforeEach, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M34 — o diagnóstico roda contra o ACERVO REAL do workspace, não contra fixture sintética.
 *
 * É o critério da DoD, e a razão é direta: colisão só existe em relação a um acervo. Medir contra
 * fixture responderia sobre um mundo que não é o do autor.
 */

const stubQueue = {} as unknown as PgBoss;

async function seed(skillId: string, name: string, description: string): Promise<void> {
  const revisionId = `rev_${createId()}`;
  const searchText = `${name} ${description}`;
  await getPool().query(
    `INSERT INTO skills (skill_id, name, description, latest_revision_id, search_text, lifecycle, enabled)
     VALUES ($1,$2,$3,$4,$5,'active',true)`,
    [skillId, name, description, revisionId, searchText],
  );
  await getPool().query(
    `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
     VALUES ($1,$2,'\\x00','h','{}'::jsonb,$3)`,
    [revisionId, skillId, description],
  );
  const v = stubEmbed(searchText);
  await getPool().query(
    `INSERT INTO embeddings (id, revision_id, skill_id, provider, model, dimensions, vector)
     VALUES ($1,$2,$3,'stub','stub',1536,$4::vector)`,
    [`emb_${createId()}`, revisionId, skillId, `[${v.join(',')}]`],
  );
}

describeIntegration('M34 — descobribilidade diagnosticada contra o acervo real', () => {
  beforeEach(async () => {
    await truncateAll();
    await seed('sk_cambio_v1', 'Converter moeda', 'Converte moeda estrangeira para reais usando a cotação do dia.');
  });
  afterAll(closePool);

  const app = () =>
    createApp({
      pool: getPool(),
      queue: stubQueue,
      logger: createNoopLogger(),
      embedder: createStubEmbedder(),
      principalResolver: (): Principal => ({
        workspaceId: 'default',
        userId: 'u',
        role: 'admin',
        scopes: ['skills:read'],
      }),
    });

  const diagnosticar = (body: Record<string, unknown>) =>
    app().request('/v1/skills:discoverability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('nomeia a CAUSA, não só um número — descrição genérica', async () => {
    const res = await diagnosticar({ name: 'Conversor', description: 'converte', has_embedding: true });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { discoverable: boolean; causes: string[]; hints: string[] };
    expect(body.discoverable).toBe(false);
    expect(body.causes).toContain('description_too_generic');
    // A causa vem com O QUE FAZER — um recall sem diagnóstico não diz ao autor o que corrigir.
    expect(body.hints.length).toBeGreaterThan(0);
  });

  it('um rascunho é ANALISADO, não recusado — e sem ser acusado do que não é culpa dele', async () => {
    // Quem está autorando ainda NÃO publicou: não ter vetor é o estado normal dele, e recusar a
    // análise por isso deixaria o autor sem o diagnóstico justamente quando ele ainda pode agir.
    //
    // Esta frase é a original deste teste, e ela sempre esteve certa. A asserção abaixo é que
    // não estava: ela exigia `causes` conter `no_embedding` — ou seja, **codificava o defeito**
    // que a theo-skills#144 descreveu, afirmando o oposto do comentário logo acima dela.
    //
    // Enquanto ela existiu, corrigir o defeito reprovaria o teste, e o teste "protegia" o
    // comportamento errado. Um teste que contradiz o próprio comentário é um alarme.
    const res = await diagnosticar({
      name: 'Analisar contrato',
      description: 'Lê um contrato em PDF e aponta cláusulas de rescisão e multa para revisão jurídica.',
    });

    const body = (await res.json()) as { causes: string[] };
    expect(res.status).toBe(200);
    expect(body.causes).not.toContain('no_embedding');
  });

  it('o relatório carrega QUAL EMBEDDER o produziu — risco #1 do milestone', async () => {
    // O número mede o embedder tanto quanto a skill. Sem este campo, alguém compararia resultados
    // de embedders diferentes sem perceber que comparou coisas distintas.
    const res = await diagnosticar({ name: 'x', description: 'y', has_embedding: true });
    const body = (await res.json()) as { embedder: string };
    expect(body.embedder).toContain('stub');
  });

  it('a própria skill NÃO colide consigo mesma numa re-análise', async () => {
    // Sem excluir a si, uma skill já publicada apareceria como vizinha de ~1.0 e o diagnóstico
    // acusaria colisão consigo — conselho impossível de seguir.
    const res = await diagnosticar({
      skill_id: 'sk_cambio_v1',
      name: 'Converter moeda',
      description: 'Converte moeda estrangeira para reais usando a cotação do dia.',
      has_embedding: true,
    });

    const body = (await res.json()) as { causes: string[] };
    expect(body.causes).not.toContain('collides_with_sibling');
  });

  it('recusa corpo sem name/description em vez de diagnosticar o vazio', async () => {
    expect((await diagnosticar({ description: 'só descrição' })).status).toBe(400);
    expect((await diagnosticar({ name: 'só nome' })).status).toBe(400);
  });

  it('NÃO executa a skill — nenhuma operação é enfileirada', async () => {
    // A fronteira "execução é responsabilidade do Theokit" é verificável: se o diagnóstico
    // invocasse a skill, haveria rastro. A fila é um stub sem métodos — qualquer chamada nela
    // lançaria, e o teste falharia com TypeError em vez de passar.
    const res = await diagnosticar({ name: 'Converter moeda', description: 'x'.repeat(80), has_embedding: true });
    expect(res.status).toBe(200);

    const { rows } = await getPool().query<{ n: string }>('SELECT count(*) AS n FROM operations');
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });
  it('rascunho (has_embedding AUSENTE) não é acusado de não ter vetor — theo-skills#144', async () => {
    // O contexto da tela de autoria: a skill ainda não foi publicada, então não tem revisão e
    // não tem vetor. Acusá-la disso reporta como defeito uma consequência de ainda não ter
    // publicado — e, por disparar sempre, ENCOBRE as causas que o autor pode corrigir agora.
    //
    // Medido no app-dev antes da correção: `causes: ["no_embedding"]` com o hint "Republique
    // para gerar o vetor", instrução impossível para algo nunca publicado.
    const res = await diagnosticar({ name: 'Converter moeda', description: 'x'.repeat(80) });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { discoverable: boolean; causes: string[]; hints: string[] };
    expect(body.causes).not.toContain('no_embedding');
    expect(body.discoverable).toBe(true);
    // E a ressalva honesta: sem causa alguma, ele ainda não é achável — porque não existe.
    expect(body.hints.join(' ')).toMatch(/publicar/i);
  });

  it('`has_embedding: false` EXPLÍCITO continua acusando — ali o achado é real', async () => {
    // O contraste que prova que a correção não desligou o detector. Para uma revisão publicada,
    // faltar vetor significa que a ingestão falhou ou não rodou, e o autor pode agir.
    const res = await diagnosticar({
      name: 'Converter moeda',
      description: 'x'.repeat(80),
      has_embedding: false,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { causes: string[]; hints: string[] };
    expect(body.causes).toContain('no_embedding');
    expect(body.hints.join(' ')).toMatch(/republique/i);
  });
});
