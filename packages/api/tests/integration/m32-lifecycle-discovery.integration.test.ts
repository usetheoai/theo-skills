import { createKeywordRetriever } from '@usetheo/skills';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDb } from '../../src/server/db.js';
import { createSkillsStore } from '../../src/server/store/skills-store.js';

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

  it('a skill deprecada CONTINUA resolvível pelo CAMINHO DE LEITURA do produto', async () => {
    // A metade que protege quem já integrou.
    //
    // POR QUE VIA `store.getView` E NÃO VIA SQL: a versão anterior deste teste consultava a
    // tabela direto e por isso NÃO exercitava o caminho que o produto usa. Um review acabou
    // provando empiricamente: uma edição que acrescentou `eq(skills.lifecycle,'active')` ao
    // `getView` — precisamente a quebra que este teste existe para impedir — passou com o teste
    // VERDE. Um teste que consulta o banco em vez do código prova que a coluna foi escrita,
    // nunca que a garantia vale.
    const store = createSkillsStore(createDb(getPool()), WS);
    const view = await store.getView('conversor-velho');

    expect(view).toBeDefined();
    expect(view?.lifecycle).toBe('deprecated');
  });

  it('o motivo e a sucessora chegam ao CONTRATO DE LEITURA — não só ao banco', async () => {
    // Um agente que descobre "deprecada" sem saber por quê nem o que usar no lugar tem a mesma
    // informação de um 404. Por isso a asserção é sobre o que o contrato DEVOLVE.
    const store = createSkillsStore(createDb(getPool()), WS);
    const view = await store.getView('conversor-velho');

    expect(view?.deprecation_reason).toBe('substituída por conversor-vivo');
  });

  it('a skill viva não carrega motivo nem sucessora', async () => {
    const store = createSkillsStore(createDb(getPool()), WS);
    const view = await store.getView('conversor-vivo');

    expect(view?.lifecycle).toBe('active');
    expect(view?.deprecation_reason).toBeUndefined();
    expect(view?.superseded_by).toBeUndefined();
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

  it('deprecada E desabilitada ao mesmo tempo continua resolvível', async () => {
    // Linha 4 da tabela do ADR D1: os dois eixos podem estar "desligados" juntos e ainda assim
    // a resolução serve quem já referencia. Sem este caso, a composição das dimensões só era
    // provada na busca, nunca na leitura.
    await getPool().query(
      `UPDATE skills SET enabled = false WHERE workspace_id = $1 AND skill_id = 'conversor-velho'`,
      [WS],
    );
    try {
      const store = createSkillsStore(createDb(getPool()), WS);
      const view = await store.getView('conversor-velho');
      expect(view?.lifecycle).toBe('deprecated');
      expect(view?.enabled).toBe(false);
    } finally {
      await getPool().query(
        `UPDATE skills SET enabled = true WHERE workspace_id = $1 AND skill_id = 'conversor-velho'`,
        [WS],
      );
    }
  });

  it('a skill APAGADA não resolve — deprecar e apagar são eixos diferentes', async () => {
    // O contraste que dá sentido ao milestone: `deprecated` continua servindo, `DELETED` não.
    // Sem este caso, nada no repositório prova que os dois eixos se comportam de forma oposta.
    await getPool().query(
      `INSERT INTO skills (workspace_id, skill_id, name, description, search_text, state, deleted_at)
       VALUES ($1,'conversor-apagado','apagado','converte documentos','converte documentos','DELETED', now())`,
      [WS],
    );

    const store = createSkillsStore(createDb(getPool()), WS);
    expect(await store.getView('conversor-apagado')).toBeUndefined();
  });
});
