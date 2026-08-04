import { describe, expect, it } from 'vitest';

import { RetrieveParamsSchema, RetrieveResultSchema } from './index.js';

describe('RetrieveParamsSchema', () => {
  it('defaults strategy=hybrid and top_k=5', () => {
    const p = RetrieveParamsSchema.parse({ query: 'find a pdf tool' });
    expect(p).toEqual({
      query: 'find a pdf tool',
      top_k: 5,
      strategy: 'hybrid',
      // M32 — as três flags de ciclo de vida entram com default `false`, e a asserção as lista
      // de propósito: o objeto inteiro é comparado justamente para que um campo novo no
      // contrato de entrada não passe despercebido. Foi este teste que barrou a adição
      // silenciosa quando o M32 estendeu o schema.
      include_draft: false,
      include_deprecated: false,
      include_disabled: false,
    });
  });

  it('rejects a lifecycle flag with a value that is neither true nor false', () => {
    // `z.coerce.boolean()` consideraria QUALQUER string não-vazia verdadeira, então
    // `include_deprecated=talvez` viria como `true` e o consumidor receberia o acervo
    // completo sem ter pedido. O enum explícito é o que torna isso um 400.
    expect(RetrieveParamsSchema.safeParse({ query: 'x', include_deprecated: 'talvez' }).success).toBe(
      false,
    );
  });

  it('treats an explicit false as a negation, not as a truthy string', () => {
    expect(RetrieveParamsSchema.parse({ query: 'x', include_deprecated: 'false' }).include_deprecated).toBe(
      false,
    );
    expect(RetrieveParamsSchema.parse({ query: 'x', include_deprecated: '1' }).include_deprecated).toBe(
      true,
    );
  });

  it('coerces top_k from a string query param', () => {
    expect(RetrieveParamsSchema.parse({ query: 'x', top_k: '10' }).top_k).toBe(10);
  });

  it('rejects an empty query and an unknown strategy', () => {
    expect(RetrieveParamsSchema.safeParse({ query: '' }).success).toBe(false);
    expect(RetrieveParamsSchema.safeParse({ query: 'x', strategy: 'magic' }).success).toBe(false);
  });

  it('clamps top_k to the 1..50 range', () => {
    expect(RetrieveParamsSchema.safeParse({ query: 'x', top_k: 0 }).success).toBe(false);
    expect(RetrieveParamsSchema.safeParse({ query: 'x', top_k: 51 }).success).toBe(false);
  });
});

describe('RetrieveResultSchema', () => {
  it('requires skill_id + numeric score + name + description', () => {
    const r = RetrieveResultSchema.parse({ skill_id: 's1', score: 0.42, name: 'N', description: 'D' });
    expect(r.score).toBe(0.42);
  });
});
