/**
 * Principal + Workspace — os tipos de domínio do isolamento multi-inquilino.
 *
 * Um {@link Principal} é o que uma credencial RESOLVE: responde "de quem é esta chave?"
 * (o inquilino e suas capacidades), não apenas "a chave é válida?". Toda requisição carrega
 * um Principal; todo dado pertence ao workspace dele; toda consulta é filtrada por
 * `workspaceId`.
 *
 * Isolamento em nível de APLICAÇÃO, não um banco por inquilino: coluna `workspace_id`
 * denormalizada nas tabelas consultadas, primeira em todo `WHERE`. Espelha o
 * `theo-memory/packages/core/src/domain/principal.ts` — o ecossistema fala uma língua só.
 *
 * O `workspaceId` é injetado no SERVIDOR e NUNCA pode vir do corpo ou de um cabeçalho da
 * requisição (ADR-M11-2): cabeçalho é falsificável por qualquer cliente.
 */

/** A fronteira do inquilino. Todo dado pertence a exatamente um workspace. */
export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

/**
 * Privilégio de um usuário DENTRO de um workspace.
 *
 * Ortogonal a {@link Principal.scopes}: `role` governa PERTENCIMENTO (quem administra
 * membros, quem cunha chave); `scopes` governa CAPACIDADE sobre o dado (ler/escrever/
 * publicar/administrar). Um `owner` com escopo só-leitura não escreve.
 *
 * Os papéis são consumidos por M13; o tipo nasce aqui porque o Principal já o carrega.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member';

/** Ranking ordinal — maior é mais privilegiado. */
const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Verdadeiro quando `role` é ao menos tão privilegiado quanto `min`.
 *
 * É o mesmo predicado consultado pelo gate de rota e pelo guard anti-escalada de M13 —
 * duas regras derivadas de uma definição só.
 */
export function roleSatisfies(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Resolvido de uma credencial. Carrega o inquilino (`workspaceId`), o membro em nome de quem
 * a chave age (`userId`, `null` para credencial de workspace sem membro), o papel desse
 * membro e as capacidades da chave.
 *
 * `userId` é `string | null` DE PROPÓSITO. O theo-memory tentou torná-lo obrigatório no tipo
 * (ADR-0021) e isso quebrou o acesso de administrador do workspace, que legitimamente não age
 * em nome de ninguém. A lição herdada: o vínculo se aplica na FRONTEIRA de resolução, não
 * engessando o tipo.
 */
export interface Principal {
  readonly workspaceId: string;
  readonly userId: string | null;
  readonly role: WorkspaceRole;
  readonly scopes: readonly string[];
}

/**
 * Workspace para o qual toda requisição sem credencial colapsa (ponte legada).
 *
 * LITERAL FIXO, não UUID gerado: a instalação single-tenant que existe hoje precisa que o
 * identificador seja o MESMO entre reinícios, senão cada boot criaria um inquilino novo e os
 * dados anteriores ficariam inalcançáveis.
 */
export const DEFAULT_WORKSPACE_ID = 'default';

/**
 * Principal da ponte legada. Papel `owner` porque, numa instalação single-tenant sem
 * autenticação, quem alcança a API já é o dono de tudo — fingir menos privilégio seria teatro.
 *
 * Isto NÃO é o default de um erro de autenticação: quando M12 existir e o backend de auth
 * falhar, a resposta é `503`, jamais este Principal (fail-closed).
 */
export const DEFAULT_PRINCIPAL: Principal = Object.freeze({
  workspaceId: DEFAULT_WORKSPACE_ID,
  userId: null,
  role: 'owner',
  scopes: Object.freeze(['skills:read', 'skills:write', 'skills:publish', 'skills:admin']),
});
