import { type LifecycleVisibility } from '../skill-lifecycle.js';

import { type ParamBuilder } from './param-builder.js';

/**
 * Traduz a especificação de visibilidade (domínio) para a cláusula SQL da DESCOBERTA.
 *
 * Existe em um lugar só, deliberadamente (ADR D3 do plano `m32-skill-lifecycle`). Se cada
 * consulta montasse a condição à mão, bastaria um retriever novo esquecer a cláusula para a
 * deprecada reaparecer na busca — e o defeito só apareceria quando alguém reclamasse de ver
 * uma skill descontinuada.
 *
 * NUNCA é chamado no caminho de RESOLUÇÃO (leitura por id / instrução). Essa assimetria é a
 * garantia central do M32: a skill deprecada some da descoberta e continua servindo quem já a
 * referencia. Ver `m32-lifecycle-discovery.integration.test.ts`.
 *
 * Os valores vão por parâmetro, nunca interpolados — o estágio é dado que atravessa a fronteira
 * HTTP, e concatená-lo seria injeção pela porta da frente, como o filtro de categoria já
 * documenta no `keyword-retriever`.
 */
export function buildLifecycleClause(
  b: ParamBuilder,
  visibility: LifecycleVisibility | undefined,
  alias = 's',
): string {
  // Ausente = default seguro da descoberta. Não é o mesmo que "sem filtro": um retriever que
  // omite a visibilidade está pedindo o comportamento padrão, não o acervo inteiro.
  const spec: LifecycleVisibility = visibility ?? { stages: ['active'], requireEnabled: true };

  const stagePlaceholders = spec.stages.map((stage) => b.bind(stage)).join(', ');
  const clauses = [`${alias}.lifecycle IN (${stagePlaceholders})`];
  if (spec.requireEnabled) {
    clauses.push(`${alias}.enabled = true`);
  }
  return ` AND ${clauses.join(' AND ')}`;
}
