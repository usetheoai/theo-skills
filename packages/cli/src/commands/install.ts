import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

/** Metadado de proveniência gravado dentro da pasta da skill. */
export interface InstallProvenance {
  readonly registry: string;
  readonly skill_id: string;
  readonly revision_id: string;
  readonly content_hash: string;
  readonly installed_at: string;
}

export const PROVENANCE_FILE = '.theoskill.json';

export interface InstallDeps {
  readonly out: (line: string) => void;
  readonly fetch: typeof globalThis.fetch;
  readonly registry: string;
  readonly auth?: string;
  /** Raiz de instalação. Default: `.claude/skills` no cwd (project-local). */
  readonly skillsDir?: string;
  /** `true` instala em `~/.claude/skills`. */
  readonly global?: boolean;
  /** Extrai o zip para o diretório. Injetado para o teste não depender de zip real. */
  readonly extract: (zip: Buffer, destDir: string) => Promise<void>;
  readonly now?: () => Date;
}

/**
 * Diretório de instalação — o MESMO layout que os agentes já leem.
 *
 * `.claude/skills/<name>/`, project-local por padrão e global com `--global`. É o layout do
 * `openskills` (`src/utils/dirs.ts`), e adotá-lo é a decisão 4 do ADR 0005: a
 * interoperabilidade acontece por DISCO, não por API — o `openskills` não tem cliente HTTP
 * e não é nosso para mudar. Uma skill publicada aqui fica visível para qualquer agente sem
 * que nenhuma das duas ferramentas conheça a outra.
 */
export function resolveSkillsDir(opts: { global?: boolean; skillsDir?: string }): string {
  if (opts.skillsDir !== undefined) return opts.skillsDir;
  return opts.global === true ? join(homedir(), '.claude', 'skills') : join(process.cwd(), '.claude', 'skills');
}

/**
 * Recusa um nome que escape do diretório de skills.
 *
 * O `name` vem do frontmatter da skill — dado de TERCEIRO. Um `../../.ssh` escreveria fora
 * do alvo, e o teste negativo com nome hostil é obrigatório, não zelo: é o modo clássico de
 * um instalador virar escrita arbitrária no disco de quem instala.
 */
export function safeSkillDir(root: string, name: string): string {
  const candidate = resolve(root, normalize(name));
  const rootResolved = resolve(root);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) {
    throw new Error(`nome de skill inválido (escaparia do diretório de instalação): ${name}`);
  }
  if (isAbsolute(name)) throw new Error(`nome de skill inválido (caminho absoluto): ${name}`);
  return candidate;
}

interface RevisionResponse {
  readonly revision_id: string;
  readonly content_hash: string;
  readonly payload_base64: string;
}

interface SkillResponse {
  readonly skill_id: string;
  readonly name: string;
  readonly latest_revision_id: string;
}

/**
 * `theoskill install <skill-id>` — M18.
 *
 * Fecha a dívida nomeada pelo ADR 0005: até aqui o registry publicava skills que nenhum
 * agente instalava, porque a CLI falava HTTP e não materializava nada no disco.
 */
export async function runInstall(skillId: string, deps: InstallDeps): Promise<number> {
  const headers: Record<string, string> = deps.auth !== undefined ? { authorization: `Bearer ${deps.auth}` } : {};

  const skillRes = await deps.fetch(`${deps.registry}/v1/skills/${skillId}`, { headers });
  if (!skillRes.ok) {
    deps.out(`erro: skill ${skillId} não encontrada (HTTP ${String(skillRes.status)})`);
    return 1;
  }
  const skill = (await skillRes.json()) as SkillResponse;

  const revRes = await deps.fetch(`${deps.registry}/v1/skills/${skillId}/revisions/${skill.latest_revision_id}`, {
    headers,
  });
  if (!revRes.ok) {
    deps.out(`erro: revisão ${skill.latest_revision_id} indisponível (HTTP ${String(revRes.status)})`);
    return 1;
  }
  const revision = (await revRes.json()) as RevisionResponse;

  const zip = Buffer.from(revision.payload_base64, 'base64');

  // INTEGRIDADE ANTES DO DISCO (M18 DoD #2).
  //
  // Verificar depois de extrair deixaria uma pasta parcial de conteúdo não confiável no
  // ambiente do usuário — e um agente que varre o diretório a carregaria antes de alguém
  // notar. Aqui, hash divergente aborta sem escrever nada.
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== revision.content_hash) {
    deps.out(`erro: integridade falhou — esperado ${revision.content_hash}, obtido ${actual}. Nada foi escrito.`);
    return 1;
  }

  const root = resolveSkillsDir({ ...(deps.global !== undefined ? { global: deps.global } : {}), ...(deps.skillsDir !== undefined ? { skillsDir: deps.skillsDir } : {}) });
  let dest: string;
  try {
    dest = safeSkillDir(root, skill.name);
  } catch (err) {
    deps.out(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // IDEMPOTENTE: reinstalar substitui. Sem o `rm`, um arquivo removido numa revisão nova
  // permaneceria no disco e o agente continuaria a carregá-lo — uma skill que ninguém
  // publicou mais.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await deps.extract(zip, dest);

  const provenance: InstallProvenance = {
    registry: deps.registry,
    skill_id: skill.skill_id,
    revision_id: revision.revision_id,
    content_hash: revision.content_hash,
    installed_at: (deps.now ?? (() => new Date()))().toISOString(),
  };
  await writeFile(join(dest, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');

  deps.out(`instalado ${skill.name} (${revision.revision_id}) em ${dest}`);
  return 0;
}
