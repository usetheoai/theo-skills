import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type InstallDeps, type InstallProvenance, PROVENANCE_FILE, resolveSkillsDir, runInstall, safeSkillDir } from './install.js';

export interface UpdateDeps extends Omit<InstallDeps, 'auth'> {
  readonly auth?: string;
  /** `true` aplica sem confirmar. Sem ele, o comando apenas MOSTRA o que mudaria. */
  readonly apply?: boolean;
}

interface SkillResponse {
  readonly skill_id: string;
  readonly name: string;
  readonly latest_revision_id: string;
}

interface RevisionMeta {
  readonly revision_id: string;
  readonly version?: string;
}

/**
 * `theoskill update <nome>` — M19 DoD #4.
 *
 * Respeita a PROCEDÊNCIA gravada na instalação (`.theoskill.json`): o registry de origem e a
 * skill instalada saem de lá, não de flags que o usuário teria de lembrar. Atualizar de um
 * registry diferente daquele que instalou seria troca silenciosa de fornecedor.
 *
 * MOSTRA O DIFF ANTES DE SOBRESCREVER, e por padrão não aplica. O conteúdo de uma skill é
 * instrução executável para um agente: sobrescrever sem que ninguém veja o que mudou é como
 * atualizar código de produção sem revisar o diff. `--apply` é a decisão explícita.
 */
export async function runUpdate(nome: string, deps: UpdateDeps): Promise<number> {
  const root = resolveSkillsDir({
    ...(deps.global !== undefined ? { global: deps.global } : {}),
    ...(deps.skillsDir !== undefined ? { skillsDir: deps.skillsDir } : {}),
    ...(deps.runtime !== undefined ? { runtime: deps.runtime } : {}),
  });

  let dir: string;
  try {
    dir = safeSkillDir(root, nome);
  } catch (err) {
    deps.out(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let prov: InstallProvenance;
  try {
    prov = JSON.parse(await readFile(join(dir, PROVENANCE_FILE), 'utf8')) as InstallProvenance;
  } catch {
    deps.out(`erro: ${nome} não parece instalado (sem ${PROVENANCE_FILE} em ${dir})`);
    return 1;
  }

  // O registry vem da procedência, NÃO de `deps.registry`: atualizar de outro registry seria
  // troca silenciosa de fornecedor sobre uma skill que o usuário confiou a alguém específico.
  const registry = prov.registry;
  const headers: Record<string, string> = deps.auth !== undefined ? { authorization: `Bearer ${deps.auth}` } : {};

  const skillRes = await deps.fetch(`${registry}/v1/skills/${prov.skill_id}`, { headers });
  if (!skillRes.ok) {
    deps.out(`erro: skill ${prov.skill_id} indisponível em ${registry} (HTTP ${String(skillRes.status)})`);
    return 1;
  }
  const skill = (await skillRes.json()) as SkillResponse;

  if (skill.latest_revision_id === prov.revision_id) {
    deps.out(`${nome} já está atualizada (${prov.revision_id})`);
    return 0;
  }

  // O diff de VERSÃO — não do conteúdo. O que o operador precisa decidir é se aceita o salto
  // (patch? major?), e para isso a versão diz mais que um diff de bytes que ninguém leria.
  const revRes = await deps.fetch(`${registry}/v1/skills/${prov.skill_id}/revisions/${skill.latest_revision_id}`, {
    headers,
  });
  const nova = revRes.ok ? ((await revRes.json()) as RevisionMeta) : undefined;

  const atualRev = prov.revision_id;
  const novaRev = skill.latest_revision_id;
  deps.out(`${nome}: ${atualRev} → ${novaRev}`);
  if (nova?.version !== undefined) deps.out(`  versão: ${nova.version}`);
  deps.out(`  registry: ${registry}`);

  if (deps.apply !== true) {
    // Não aplicar por padrão é a escolha central deste comando. Uma skill é instrução
    // executável para um agente; sobrescrever sem revisão é atualizar produção às cegas.
    deps.out('  (nada foi alterado — use --apply para atualizar)');
    return 0;
  }

  return runInstall(prov.skill_id, {
    out: deps.out,
    fetch: deps.fetch,
    registry,
    extract: deps.extract,
    ...(deps.auth !== undefined ? { auth: deps.auth } : {}),
    ...(deps.skillsDir !== undefined ? { skillsDir: deps.skillsDir } : {}),
    ...(deps.global !== undefined ? { global: deps.global } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
}
