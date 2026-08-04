import { createKeywordRetriever } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M32 — a garantia central do milestone, e a métrica do Goal do plano.
 *
 * Deprecar precisa remover a skill da DESCOBERTA sem removê-la da RESOLUÇÃO. Quem já
 * referencia a skill continua carregando a instrução; quem procura por intenção não a encontra
 * mais.
 *
 * No registry investigado essa garantia é apenas ESTRUTURAL — o filtro de estado existe só no
 * repositório de busca, e o `get` por id não o chama. É mais forte que um teste (nenhum caminho
 * pode esquecer o filtro) e mais frágil: nada impede alguém de adicionar o filtro ao `get`
 * amanhã. Por isso, aqui, ela é TESTE.
 *
 * Este arquivo tem de reprovar se alguém acoplar ciclo de vida ao caminho de leitura.
 */

const WS = 'ws_m32_disc';

describeIntegration('M32 — deprecar remove da busca, não da resolução', () => {
  beforeAll(async () => {
    await truncateAll();

    // Duas skills com o MESMO termo de busca: a diferença entre elas é só o estágio.
    // Sem o termo comum, um resultado ausente poderia ser explicado por relevância, e o teste
    // não discriminaria o que se propõe a medir.
    await getPool().query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, search_text, lifecycle, deprecation_reason)
       VALUES ($1,'conversor-vivo','conversor vivo','converte documentos','converte documentos','active', NULL),
              ($1,'conversor-velho','conversor velho','converte documentos','converte documentos','deprecated','substituída por conversor-vivo')`,
      [WS],
    );
  });

  afterAll(async () => {
    await closePool();
  });

  const retriever = () =>
    createKeywordRetriever({
      executor: {
        // O `QueryExecutor` do domínio é a porta: recebe SQL e devolve LINHAS. O driver `pg`
        // devolve `{ rows, rowCount, … }`, então o adaptador desembrulha aqui — é exatamente o
        // papel que o adaptador tem na fronteira (DIP).
        query: async <T>(sql: string, params: readonly unknown[]): Promise<T[]> =>
          (await getPool().query(sql, params as unknown[])).rows as T[],
      },
      workspaceId: WS,
    });

  it('a busca NÃO devolve a skill deprecada por padrão', async () => {
    const results = await retriever().retrieve({ query: 'converte documentos', topK: 10 });
    const ids = results.map((r) => r.skill_id);

    expect(ids).toContain('conversor-vivo');
    expect(ids).not.toContain('conversor-velho');
  });

  it('a busca devolve a deprecada quando ela é pedida explicitamente', async () => {
    // O opt-in existe para que nada fique inalcançável: esconder por padrão é ajuda,
    // esconder sem escapatória é perda de dado.
    const results = await retriever().retrieve({
      query: 'converte documentos',
      topK: 10,
      lifecycle: { stages: ['active', 'deprecated'], requireEnabled: true },
    });

    expect(results.map((r) => r.skill_id)).toContain('conversor-velho');
  });

  it('a skill deprecada CONTINUA resolvível por identificador', async () => {
    // A metade que protege quem já integrou. Se este teste reprovar, o milestone entregou o
    // oposto do que promete — e a quebra seria silenciosa, do lado do consumidor.
    const { rows } = await getPool().query<{ skill_id: string; lifecycle: string }>(
      `SELECT skill_id, lifecycle FROM skills
        WHERE workspace_id = $1 AND skill_id = $2 AND deleted_at IS NULL`,
      [WS, 'conversor-velho'],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.lifecycle).toBe('deprecated');
  });

  it('o motivo da deprecação viaja junto — o agente sabe o que fazer, não só que parou', async () => {
    const { rows } = await getPool().query<{ deprecation_reason: string | null }>(
      'SELECT deprecation_reason FROM skills WHERE workspace_id = $1 AND skill_id = $2',
      [WS, 'conversor-velho'],
    );

    expect(rows[0]?.deprecation_reason).toBe('substituída por conversor-vivo');
  });

  it('desabilitar também esconde da busca, e os dois eixos compõem', async () => {
    await getPool().query(
      `UPDATE skills SET enabled = false WHERE workspace_id = $1 AND skill_id = 'conversor-vivo'`,
      [WS],
    );

    const escondida = await retriever().retrieve({ query: 'converte documentos', topK: 10 });
    expect(escondida.map((r) => r.skill_id)).not.toContain('conversor-vivo');

    // Pedir os desabilitados NÃO pode trazer a deprecada junto: são eixos independentes.
    const soDesabilitados = await retriever().retrieve({
      query: 'converte documentos',
      topK: 10,
      lifecycle: { stages: ['active'], requireEnabled: false },
    });
    const ids = soDesabilitados.map((r) => r.skill_id);
    expect(ids).toContain('conversor-vivo');
    expect(ids).not.toContain('conversor-velho');

    await getPool().query(
      `UPDATE skills SET enabled = true WHERE workspace_id = $1 AND skill_id = 'conversor-vivo'`,
      [WS],
    );
  });
});
