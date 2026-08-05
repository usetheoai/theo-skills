/**
 * Versionamento semântico das revisões (M19).
 *
 * O consumidor precisa declarar INTENÇÃO (`@stable`, `@^1.2.0`) em vez de escolher um id de
 * revisão. Para isso a revisão precisa carregar uma versão comparável — e o registry precisa
 * recusar o que tornaria a comparação mentirosa: retrocesso e colisão.
 */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Pré-lançamento (`1.2.0-beta.1` → `beta.1`), ou `null`. */
  readonly prerelease: string | null;
}

export class InvalidVersionError extends Error {
  constructor(raw: string) {
    super(`invalid version: ${raw}`);
    this.name = 'InvalidVersionError';
  }
}

// Subconjunto DELIBERADO da spec semver: sem build metadata (`+sha`). Metadata não participa
// da precedência (semver.org § 10), então aceitá-la criaria duas versões que se comparam como
// iguais mas são distintas como string — e a chave de unicidade do registry passaria a
// depender de algo que a ordenação ignora.
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw: string): SemVer {
  const m = SEMVER_RE.exec(raw);
  if (m === null) throw new InvalidVersionError(raw);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

export function formatVersion(v: SemVer): string {
  const base = `${String(v.major)}.${String(v.minor)}.${String(v.patch)}`;
  return v.prerelease === null ? base : `${base}-${v.prerelease}`;
}

/** Compara identificadores de pré-lançamento conforme semver.org § 11. */
function comparePrerelease(a: string | null, b: string | null): number {
  // Ausência de pré-lançamento tem precedência MAIOR: `1.0.0` > `1.0.0-beta`. É o oposto da
  // intuição alfabética, e inverter isto faria um beta parecer mais novo que o lançamento.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (nx !== ny) {
      // Numérico tem precedência MENOR que alfanumérico (§ 11.4.3).
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** `-1` se `a < b`, `0` se iguais, `1` se `a > b`. */
export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

export class VersionRejectedError extends Error {
  constructor(
    readonly reason: 'not_greater' | 'duplicate',
    message: string,
  ) {
    super(message);
    this.name = 'VersionRejectedError';
  }
}

/**
 * Aceita a nova versão apenas se ela for ESTRITAMENTE maior que todas as existentes.
 *
 * Recusar retrocesso e colisão é o que faz `@^1.2.0` significar algo estável. Sem isso um
 * publisher republicaria `1.2.0` com outro conteúdo, e o mesmo intervalo passaria a resolver
 * para bytes diferentes conforme o momento — o consumidor não teria como saber o que instalou.
 */
export function assertPublishable(next: SemVer, existentes: readonly SemVer[]): void {
  for (const v of existentes) {
    if (compareVersions(next, v) === 0) {
      throw new VersionRejectedError('duplicate', `version ${formatVersion(next)} already exists`);
    }
  }
  const highest = existentes.reduce<SemVer | null>((acc, v) => (acc === null || compareVersions(v, acc) > 0 ? v : acc), null);
  if (highest !== null && compareVersions(next, highest) < 0) {
    throw new VersionRejectedError(
      'not_greater',
      `version ${formatVersion(next)} is older than the most recent one (${formatVersion(highest)})`,
    );
  }
}

/**
 * Resolve um intervalo (`^1.2.0`, `~1.2.0`, `1.2.3`, `latest`) para a MAIOR versão que o
 * satisfaz. Devolve `null` quando nenhuma satisfaz.
 *
 * A resolução acontece no SERVIDOR (M19 DoD #3): o cliente declara intenção, o servidor
 * escolhe. Resolver no cliente exigiria baixar a lista inteira de versões a cada instalação
 * e deixaria dois clientes em desacordo sobre o que "^1.2.0" significa.
 *
 * Pré-lançamentos NUNCA satisfazem um intervalo — só correspondência exata os alcança. É a
 * regra do npm, e ela existe para que publicar um `2.0.0-beta` não empurre todo mundo que
 * pediu `^1.0.0` para um beta.
 */
export function resolveRange(range: string, disponiveis: readonly SemVer[]): SemVer | null {
  const ordenadas = [...disponiveis].sort(compareVersions);

  if (range === 'latest') {
    const estaveis = ordenadas.filter((v) => v.prerelease === null);
    return estaveis[estaveis.length - 1] ?? null;
  }

  const exato = SEMVER_RE.test(range);
  if (exato) {
    const alvo = parseVersion(range);
    return ordenadas.find((v) => compareVersions(v, alvo) === 0) ?? null;
  }

  const m = /^([\^~])(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (m === null) return null;
  const [, op, ma, mi, pa] = m;
  const base = { major: Number(ma), minor: Number(mi), patch: Number(pa), prerelease: null };

  const satisfaz = (v: SemVer): boolean => {
    if (v.prerelease !== null) return false;
    if (compareVersions(v, base) < 0) return false;
    if (op === '^') {
      // `^0.x.y` é especial: com major 0 a API é instável, então `^` não cruza o MINOR.
      // Ignorar isso faria `^0.1.0` aceitar `0.2.0` — uma quebra, por definição do semver.
      return base.major === 0 ? v.major === 0 && v.minor === base.minor : v.major === base.major;
    }
    return v.major === base.major && v.minor === base.minor;
  };

  const candidatas = ordenadas.filter(satisfaz);
  return candidatas[candidatas.length - 1] ?? null;
}
