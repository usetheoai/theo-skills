import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, truncateAll } from './_helpers/db.js';
import { describeIntegration } from './_helpers/env.js';

/**
 * M32 — as garantias de ciclo de vida que vivem NO BANCO, não na aplicação.
 *
 * Por que testar constraint de banco, se a fronteira HTTP já valida: porque a fronteira não é o
 * único caminho de escrita. Um script de migração de dados, uma correção manual em incidente ou
 * um `psql` durante o plantão gravam direto. Sem a restrição, um estágio que o domínio recusaria
 * entra na tabela e a busca passa a esconder — ou revelar — skills por um valor que ninguém
 * consegue explicar depois.
 *
 * O ADR D5 do plano registra que isto DIVERGE do padrão local (`state` e `visibility` são `text`
 * livre). É essa ausência de restrição que o M32 está pagando.
 *
 * Nota de método: `text('lifecycle', { enum })` do Drizzle tipa em TypeScript e **não** gera
 * CHECK — verificado na migração gerada, que saiu como `text` puro. As duas constraints abaixo
 * foram escritas à mão em `0014_lean_living_mummy.sql` justamente por isso.
 */

const WS = 'ws_m32';

describeIntegration('M32 — ciclo de vida no schema', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closePool();
  });

  async function insertSkill(
    skillId: string,
    columns: Record<string, string | boolean | null> = {},
  ): Promise<void> {
    const base: Record<string, string | boolean | null> = {
      workspace_id: WS,
      skill_id: skillId,
      name: skillId,
      description: 'fixture',
      ...columns,
    };
    const keys = Object.keys(base);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    await getPool().query(
      `INSERT INTO skills (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`,
      Object.values(base),
    );
  }

  describe('migração aditiva', () => {
    it('uma linha inserida sem os campos novos nasce active e habilitada', async () => {
      // A garantia de retrocompatibilidade: a skill que já estava em produção quando a migração
      // rodou NÃO pode sumir da busca. Marcá-la `draft` seria quebra silenciosa exatamente na
      // entrega que promete não quebrar.
      await insertSkill('herda-default');

      const { rows } = await getPool().query<{ lifecycle: string; enabled: boolean }>(
        'SELECT lifecycle, enabled FROM skills WHERE workspace_id = $1 AND skill_id = $2',
        [WS, 'herda-default'],
      );

      expect(rows[0]).toEqual({ lifecycle: 'active', enabled: true });
    });

    it('os campos de deprecação nascem nulos — skill viva não tem motivo', async () => {
      await insertSkill('sem-motivo');

      const { rows } = await getPool().query<{
        deprecation_reason: string | null;
        superseded_by: string | null;
      }>(
        'SELECT deprecation_reason, superseded_by FROM skills WHERE workspace_id = $1 AND skill_id = $2',
        [WS, 'sem-motivo'],
      );

      expect(rows[0]).toEqual({ deprecation_reason: null, superseded_by: null });
    });
  });

  describe('vocabulário fechado (skills_lifecycle_check)', () => {
    it('aceita os três estágios do domínio', async () => {
      await expect(insertSkill('e-active', { lifecycle: 'active' })).resolves.toBeUndefined();
      await expect(insertSkill('e-draft', { lifecycle: 'draft' })).resolves.toBeUndefined();
      await expect(
        insertSkill('e-deprecated', { lifecycle: 'deprecated', deprecation_reason: 'substituída' }),
      ).resolves.toBeUndefined();
    });

    it('rejeita um estágio fora do vocabulário, nomeando a constraint', async () => {
      // Caso negativo: não basta "lança" — o erro precisa dizer QUAL regra foi violada, senão
      // quem está de plantão às 3h descobre o motivo por tentativa e erro.
      await expect(insertSkill('e-invalido', { lifecycle: 'retired' })).rejects.toThrow(
        /skills_lifecycle_check/,
      );
    });

    it('rejeita DELETED, que pertence ao eixo de exclusão e não a este', async () => {
      await expect(insertSkill('e-deleted', { lifecycle: 'DELETED' })).rejects.toThrow(
        /skills_lifecycle_check/,
      );
    });
  });

  describe('integridade do par deprecação↔motivo (skills_deprecation_reason_check)', () => {
    it('rejeita deprecar sem motivo', async () => {
      // Sem motivo, um agente que recebe "deprecada" tem a mesma informação de um 404: sabe que
      // parou, não sabe o que fazer. É a lacuna do registry investigado, que o M32 preenche.
      await expect(insertSkill('dep-sem-motivo', { lifecycle: 'deprecated' })).rejects.toThrow(
        /skills_deprecation_reason_check/,
      );
    });

    it('permite deprecar com motivo, e a sucessora continua opcional', async () => {
      // Nem toda deprecação tem substituta ("esta capacidade saiu do produto"). Obrigar a
      // sucessora inventaria um ponteiro falso.
      await expect(
        insertSkill('dep-com-motivo', {
          lifecycle: 'deprecated',
          deprecation_reason: 'consolidada em outra skill',
        }),
      ).resolves.toBeUndefined();
    });

    it('não exige motivo para os estágios que não descontinuam nada', async () => {
      await expect(insertSkill('draft-sem-motivo', { lifecycle: 'draft' })).resolves.toBeUndefined();
    });
  });
});
