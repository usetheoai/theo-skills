/**
 * Classificação de erro: transitório vs definitivo (M16 DoD #2).
 *
 * A distinção governa uma decisão binária — **retentar ou não**. Errar para o lado
 * transitório transforma um `403` em tempestade de retentativas contra um servidor que já
 * disse não; errar para o definitivo faz um cliente desistir de um `503` que se resolveria
 * em dois segundos.
 *
 * Espelha o `error-classifier.ts` do theo-memory.
 */

export type ErrorKind = 'transient' | 'permanent';

export interface ClassifiedError {
  readonly kind: ErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly message: string;
}

/** Status HTTP que valem retentativa. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Códigos de rede do Node que indicam falha transitória. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function classifyHttpStatus(status: number): ClassifiedError {
  // 429 é transitório MAS carrega semântica própria: o servidor disse quando voltar. Quem
  // consome deve honrar o `Retry-After` em vez de aplicar o próprio backoff — foi por isso
  // que o cabeçalho entrou no rate limit (M17) e na quota de distribuição (M20).
  const transient = TRANSIENT_STATUS.has(status);
  return {
    kind: transient ? 'transient' : 'permanent',
    status,
    retryable: transient,
    message: `HTTP ${String(status)}`,
  };
}

export function classifyError(err: unknown): ClassifiedError {
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
    if (typeof e.status === 'number') return classifyHttpStatus(e.status);
    if (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code)) {
      return { kind: 'transient', retryable: true, message: e.code };
    }
    // `AbortError` é o timeout do próprio cliente — transitório por natureza: a requisição
    // pode nem ter chegado ao servidor.
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      return { kind: 'transient', retryable: true, message: String(e.name) };
    }
    if (typeof e.message === 'string') {
      return { kind: 'permanent', retryable: false, message: e.message };
    }
  }
  // FAIL-CLOSED na classificação: o que não se reconhece é DEFINITIVO, não transitório.
  // Assumir transitório para o desconhecido produz laço de retentativa sobre um erro que
  // nunca vai passar — e é assim que um cliente derruba o servidor tentando ajudá-lo.
  return { kind: 'permanent', retryable: false, message: String(err) };
}
