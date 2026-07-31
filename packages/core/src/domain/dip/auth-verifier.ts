import { type Principal } from '../principal.js';

/**
 * Port de autenticação (DIP) — o domínio declara o contrato, a infraestrutura implementa.
 *
 * A pergunta que ele responde é **"de quem é esta credencial?"**, não "ela é válida?".
 * Isso é deliberado e é o que torna o multi-tenant seguro: o `workspaceId` do
 * {@link Principal} devolvido é o que TODA consulta filtra, e ele vem da credencial —
 * nunca do corpo da requisição, que o cliente controla.
 *
 * O theo-memory carrega também um `verify(token): Promise<boolean>` legado, mantido lá por
 * uma janela de migração com ~12 consumidores. Aqui ele NÃO existe: o theo-skills não tem
 * esses consumidores, e nascer já com o contrato certo evita a dívida em vez de herdá-la
 * (`parsimony-ladder` rung 1 — o código que não se escreve não precisa ser removido depois).
 */
export interface AuthVerifier {
  /**
   * Resolve o {@link Principal} dono da credencial, ou `null` quando ela é inválida,
   * revogada ou expirada.
   *
   * Implementações DEVEM:
   *  - comparar segredos em **tempo constante** (RFC 6750 + OWASP REST cheatsheet), com
   *    curto-circuito por comprimento — `crypto.timingSafeEqual` lança `RangeError` em
   *    buffers de tamanhos diferentes, e deixar esse throw escapar transformaria um
   *    palpite de tamanho errado num 500 distinguível de um 401, que é o oráculo que a
   *    comparação em tempo constante existe para fechar;
   *  - devolver `null` (não lançar) para credencial revogada ou expirada;
   *  - LANÇAR quando o backend de verificação está indisponível — o middleware traduz
   *    isso em `503`, e devolver `null` nesse caso confundiria "não sei" com "não é
   *    válido", negando acesso a quem tem direito e escondendo a indisponibilidade.
   *
   * @param token — o token cru extraído de `Authorization: Bearer <token>` (RFC 6750 § 2.1).
   */
  resolvePrincipal(token: string): Promise<Principal | null>;
}
