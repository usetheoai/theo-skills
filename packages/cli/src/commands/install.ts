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
  /** `true` instala no home em vez do projeto. */
  readonly global?: boolean;
  /** Runtime que vai LER a skill. Default `claude` (ADR 0005); `theokit` para agentes Theokit. */
  readonly runtime?: SkillsRuntime;
  /** Extrai o zip para o diretório. Injetado para o teste não depender de zip real. */
  readonly extract: (zip: Buffer, destDir: string) => Promise<void>;
  readonly now?: () => Date;
}

/**
 * Runtime de agente que vai LER a skill do disco.
 *
 * Não é preferência de caminho: cada runtime descobre skills num diretório próprio e ignora
 * o do outro. Instalar no layout errado entrega a skill num lugar onde o destinatário nunca
 * olha — e o sintoma é silencioso, porque instalar dá certo.
 */
export type SkillsRuntime = 'claude' | 'theokit';

/** Diretório-base por runtime. `claude` primeiro por ser o default (ADR 0005). */
const RUNTIME_DIR: Record<SkillsRuntime, string> = {
  claude: '.claude',
  theokit: '.theokit',
};

/**
 * Diretório de instalação — o layout que o runtime ALVO de fato lê.
 *
 * `<base>/skills/<name>/`, project-local por padrão e global com `--global`.
 *
 * O default `.claude/skills` é o layout do `openskills` (`src/utils/dirs.ts`) e vem da
 * decisão 4 do ADR 0005: a interoperabilidade acontece por DISCO, não por API — o
 * `openskills` não tem cliente HTTP e não é nosso para mudar.
 *
 * O QUE FALTAVA, e é o motivo deste parâmetro existir: os dois layouts servem consumidores
 * DIFERENTES, e a decisão original só cobria um. MEDIDO em `@theokit/agents` 6.0.0 — o
 * pacote descobre skills exclusivamente em `.theokit/skills/<name>/SKILL.md` e não tem uma
 * única referência a `.claude` no `dist`. No `agent-builder` (agente Theokit real) as duas
 * pastas coexistem: dezenas de skills em `.claude/skills/` para o Claude Code, e a única
 * que o agente Theokit carrega em `.theokit/skills/daily-briefing/`.
 *
 * Enquanto só existia o default, uma skill vinda do registry era INVISÍVEL para todo agente
 * Theokit — que é justamente o consumidor que o M7 exige. Isto não revoga o ADR 0005; ele
 * continua certo para o `openskills`. Completa-o para o runtime que ficou de fora.
 */
export function resolveSkillsDir(opts: { global?: boolean; skillsDir?: string; runtime?: SkillsRuntime }): string {
  // Caminho explícito vence tudo: quem passou `--skills-dir` já decidiu o destino.
  if (opts.skillsDir !== undefined) return opts.skillsDir;
  const base = RUNTIME_DIR[opts.runtime ?? 'claude'];
  return opts.global === true ? join(homedir(), base, 'skills') : join(process.cwd(), base, 'skills');
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

  // Os BYTES vêm de uma segunda chamada, na rota de payload.
  //
  // Antes daqui o código lia `revision.payload_base64` do metadado — um campo que a API
  // NUNCA devolveu. Contra o registry real isso era `Buffer.from(undefined)`, e o comando
  // morria. O teste de contrato não pegava porque o stub inventava o campo: ele concordava
  // com a expectativa da CLI, e ninguém confrontou os dois lados com o servidor.
  const payloadRes = await deps.fetch(
    `${deps.registry}/v1/skills/${skillId}/revisions/${skill.latest_revision_id}/payload`,
    { headers },
  );
  if (!payloadRes.ok) {
    deps.out(`erro: payload da revisão ${skill.latest_revision_id} indisponível (HTTP ${String(payloadRes.status)})`);
    return 1;
  }
  const zip = Buffer.from(await payloadRes.arrayBuffer());

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

  const root = resolveSkillsDir({
    ...(deps.global !== undefined ? { global: deps.global } : {}),
    ...(deps.skillsDir !== undefined ? { skillsDir: deps.skillsDir } : {}),
    ...(deps.runtime !== undefined ? { runtime: deps.runtime } : {}),
  });
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
