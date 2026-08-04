/**
 * M34 — leitura da resposta de `POST /v1/skills:retrieve` pelo gate de descobribilidade.
 *
 * A chave é **`results`** (`server/handlers/retrieve.ts:125-127`), não `skills`. A distinção
 * parece cosmética e não é: o gate deriva daqui se a skill esperada foi achada, e uma leitura
 * que devolve sempre vazio produz uma baseline de zeros — a partir da qual nenhuma regressão é
 * detectável, porque não há como regredir de "nunca foi achada".
 */

interface ResultadoBruto {
  readonly skill_id?: unknown;
}

/**
 * Extrai, em ordem, os identificadores devolvidos pela busca.
 *
 * Devolve `[]` para qualquer corpo que não case com o contrato, em vez de lançar: o gate roda
 * sobre N consultas e derrubar tudo por causa de uma resposta estranha esconderia as outras.
 * O silêncio aqui é seguro porque a AUSÊNCIA de resultado é o sinal negativo do gate — se a
 * leitura falhar de verdade, o caso conta como "não achada" e a regressão aparece.
 */
export function idsDaResposta(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results
    .map((r: ResultadoBruto) => r?.skill_id)
    // Uma entrada sem `skill_id` viraria `undefined` na lista, e `undefined` numa posição é uma
    // posição fantasma no relatório — pior que a entrada ausente.
    .filter((id): id is string => typeof id === 'string' && id !== '');
}
