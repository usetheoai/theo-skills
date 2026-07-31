/**
 * Scopes de capacidade do registry (M12 DoD #2).
 *
 * Espelha o `scopeSatisfies` do theo-memory (`api/src/server/auth/scope-hierarchy.ts`) e o
 * precedente `roleSatisfies` deste mesmo pacote: um scope mais privilegiado SATISFAZ a
 * exigência de um mais fino que ele implica.
 *
 * A diferença em relação ao theo-memory é o EIXO da implicação, e ela vem do domínio, não
 * de preferência: lá a relação é plana (`platform-admin ⊇ admin`), porque memória tem duas
 * classes de operador. Aqui as capacidades formam uma CADEIA — publicar pressupõe escrever,
 * escrever pressupõe ler — porque um cliente que pode publicar uma skill necessariamente
 * consegue lê-la de volta.
 */

/** Scope de capacidade, do mais fino ao mais privilegiado. */
export type Scope = 'skills:read' | 'skills:write' | 'skills:publish' | 'skills:admin';

/** Todos os scopes, na ordem da cadeia. Útil para testes exaustivos e para docs. */
export const ALL_SCOPES: readonly Scope[] = ['skills:read', 'skills:write', 'skills:publish', 'skills:admin'];

/**
 * Arestas de implicação: chave = scope concedido, valor = o que ele ADICIONALMENTE satisfaz.
 *
 * Declarado por transitividade EXPLÍCITA em vez de computado por fecho: a tabela é pequena e
 * fixa, e vê-la por extenso torna a auditoria trivial — quem lê o arquivo sabe exatamente o
 * que `skills:publish` concede, sem simular um algoritmo de cabeça. Um fecho transitivo aqui
 * seria código esperto resolvendo um problema que não existe (`parsimony-ladder` rung 5).
 */
const SCOPE_IMPLIES: Readonly<Record<Scope, readonly Scope[]>> = {
  'skills:admin': ['skills:publish', 'skills:write', 'skills:read'],
  'skills:publish': ['skills:write', 'skills:read'],
  'skills:write': ['skills:read'],
  'skills:read': [],
};

/**
 * O conjunto `granted` satisfaz o scope `required`?
 *
 * FAIL-CLOSED por construção: um scope que não está na tabela — chave antiga, provider
 * externo, erro de digitação — não implica nada e nunca concede acesso por omissão. O
 * `?? []` não é defensividade decorativa: `SCOPE_IMPLIES[g]` é `undefined` para qualquer
 * string fora do union em runtime, que é exatamente o caso que um token de terceiro traz.
 */
export function scopeSatisfies(granted: readonly Scope[], required: Scope): boolean {
  if (granted.includes(required)) return true;
  for (const g of granted) {
    if ((SCOPE_IMPLIES[g] ?? []).includes(required)) return true;
  }
  return false;
}
