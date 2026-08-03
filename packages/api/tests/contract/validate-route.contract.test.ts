import { type Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import { createNoopLogger } from '../../src/server/logger.js';
// Reusa o construtor de zip que a suíte de integração já tem (parsimônia, rung 4):
// adicionar `adm-zip` seria dependência redundante com o `yazl` que o projeto já declara.
import { buildZipBase64, skillMd } from '../integration/_helpers/zip.js';
import { UPDATE_MASK_FIELDS as UPDATE_MASK_FIELDS_ESPERADOS } from '../../src/server/handlers/skills.js';

/**
 * M30 — `POST /v1/skills:validate` valida SEM publicar.
 *
 * A asserção que DISCRIMINA não é o status: um `:validate` que gravasse e respondesse `200`
 * passaria em qualquer verificação de resposta. É a CONTAGEM de efeitos — quantas vezes a fila
 * foi chamada. Por isso o duplo conta `send`, em vez de devolver um job mudo.
 */
const fakePool = {} as unknown as Pool;

function appComContador() {
  let enfileirados = 0;
  const queue = {
    send: () => {
      enfileirados += 1;
      return Promise.resolve('job');
    },
  } as unknown as PgBoss;
  return {
    app: createApp({ pool: fakePool, queue, logger: createNoopLogger() }),
    enfileirados: () => enfileirados,
  };
}

const json = { 'content-type': 'application/json' };

/** Zip VÁLIDO — o único payload que leva a rota até o fim, onde um efeito colateral moraria. */
const zipValido = (): Promise<string> =>
  buildZipBase64([{ path: 'SKILL.md', content: skillMd('teste-m30') }]);

describe('POST /v1/skills:validate (M30)', () => {
  it('a rota EXISTE — não cai em 404', async () => {
    const { app } = appComContador();
    const r = await app.request('/v1/skills:validate', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ zippedFilesystem: 'AAAA' }),
    });
    expect(r.status, 'a rota não foi registrada').not.toBe(404);
  });

  it('ZERO efeito colateral — inclusive no caminho de SUCESSO', async () => {
    // A primeira versão deste teste NÃO DISCRIMINAVA: com um payload que falha cedo
    // (`'AAAA'`), a rota nunca chega ao ponto onde enfileiraria, então acrescentar um
    // `queue.send` ao caminho de sucesso mantinha os três testes verdes. Medido por mutação.
    //
    // Um zip VÁLIDO é o único caminho que exercita o trecho perigoso. Sem ele, o AC2 é
    // verde sobre nada — exatamente o que ele existe para impedir.
    const { app, enfileirados } = appComContador();

    for (const payload of ['AAAA', await zipValido()]) {
      await app.request('/v1/skills:validate', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ zippedFilesystem: payload }),
      });
    }

    expect(enfileirados(), ':validate enfileirou trabalho — ele NÃO pode ter efeito').toBe(0);
  });

  it('recusa do MESMO ingestPayload: zip inválido → invalid_zip', async () => {
    // Prova o caminho de ingestão COMPARTILHADO (AC1) SEM comparar com o `POST` neste teste:
    // medido, o `POST` consulta o banco (`isReserved`, `getView`) ANTES de validar o zip, e
    // com pool falso ele morre em `internal_error` — o que compararia infraestrutura de teste,
    // não vocabulário de recusa. A igualdade real é exercida na suíte de integração, com banco.
    //
    // O que ESTE teste garante é que o `:validate` devolve o código do `ingestPayload`
    // compartilhado, e não um vocabulário próprio.
    const { app } = appComContador();
    const r = await app.request('/v1/skills:validate', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ zippedFilesystem: '' }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()) as { error?: string }).toMatchObject({ error: 'invalid_zip' });
  });
});

describe('SKILL.md avulso, sem ZIP (M30 T4)', () => {
  it('`:validate` aceita `skillMd` puro e extrai os mesmos campos do caminho zipado', async () => {
    // A maioria das skills é UM arquivo. Obrigar cada cliente — CLI, tela, MCP — a montar um
    // zip para um arquivo só multiplica o mesmo trabalho por três.
    const { app } = appComContador();
    const md = skillMd('teste-avulso');

    const avulso = await app.request('/v1/skills:validate', {
      method: 'POST', headers: json, body: JSON.stringify({ skillMd: md }),
    });
    const zipado = await app.request('/v1/skills:validate', {
      method: 'POST', headers: json,
      body: JSON.stringify({ zippedFilesystem: await buildZipBase64([{ path: 'SKILL.md', content: md }]) }),
    });

    expect(avulso.status, 'a rota não aceitou SKILL.md avulso').toBe(200);
    // A asserção que DISCRIMINA: mesmos campos extraídos. Um caminho que só respondesse 200
    // sem passar pelo mesmo pipeline passaria numa verificação de status.
    expect(await avulso.json()).toEqual(await zipado.json());
  });

  it('corpo sem NENHUM dos dois → recusa clara, não 500', async () => {
    const { app } = appComContador();
    const r = await app.request('/v1/skills:validate', {
      method: 'POST', headers: json, body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /v1/skills aceita skillMd avulso (M30 AC3 — rota de ESCRITA)', () => {
  it('não recusa com invalid_zip quando o corpo traz skillMd', async () => {
    // RETRATAÇÃO: o AC3 pede `POST /v1/skills`, e eu havia implementado só no `:validate`.
    // Medido contra o serviço vivo: `POST` com `skillMd` devolvia `invalid_zip`. Um dry-run
    // que aceita o que o publish recusa é a divergência que o dry-run existe para impedir.
    const { app } = appComContador();
    const r = await app.request('/v1/skills', {
      method: 'POST', headers: json,
      body: JSON.stringify({ skill_id: 'ac3-escrita', skillMd: skillMd('ac3-escrita') }),
    });
    const j = (await r.json()) as { error?: string };
    expect(j.error, 'POST recusou skillMd avulso — o AC3 pede esta rota').not.toBe('invalid_zip');
  });
});

describe('PATCH /v1/skills/:id aceita skillMd avulso — a assimetria criação/atualização', () => {
  // A mesma assimetria já produziu defeito neste código: `version` e `category` iam no job de
  // CRIAÇÃO e não no de atualização, e a segunda publicação em diante nascia sem versão, sem
  // erro algum. Aceitar `SKILL.md` só no POST repetiria a forma exata desse defeito.
  it('máscara aceita `skillMd` como campo válido', async () => {
    // A primeira versão deste teste assertava `not.toBe('invalid_update_mask')` — e passava por
    // VACUIDADE: qualquer outro erro satisfaz, inclusive o 500 do pool falso. Medido contra o
    // serviço vivo, a rota devolvia `invalid_update_mask` de verdade. A asserção agora é sobre
    // o CONJUNTO de campos aceitos, que é o que a máscara de fato governa.
    expect(
      UPDATE_MASK_FIELDS_ESPERADOS.has('skillMd'),
      'a máscara não aceita skillMd — a assimetria com o POST continua',
    ).toBe(true);
  });

  it('`zippedFilesystem` continua aceito — a mudança ACRESCENTA, não substitui', () => {
    expect(UPDATE_MASK_FIELDS_ESPERADOS.has('zippedFilesystem')).toBe(true);
  });
});
