/**
 * Invariantes de supply chain dos workflows — travados por teste.
 *
 * POR QUE ESTE ARQUIVO EXISTE: workflow é código e sofre regressão como código. O pin por
 * SHA degrada para `@v4` no primeiro PR apressado, e ninguém percebe até a action ser
 * comprometida. O actionlint valida SINTAXE; política de supply chain é outra coisa.
 *
 * Fonte dos invariantes: knowledge-base/discoveries/blueprints/m10-cicd-supply-chain-blueprint.md
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_DIR = join(process.cwd(), '.github/workflows');

interface WorkflowJob {
  readonly 'timeout-minutes'?: number;
  readonly container?: unknown;
  readonly steps?: readonly { readonly name?: string; readonly uses?: string; readonly run?: string }[];
  readonly uses?: string;
}

interface Workflow {
  readonly name?: string;
  readonly on?: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly concurrency?: { readonly group?: string };
  readonly jobs?: Record<string, WorkflowJob>;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

function readWorkflow(file: string): { raw: string; doc: Workflow } {
  const raw = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
  return { raw, doc: parse(raw) as Workflow };
}

function allJobs(doc: Workflow): [string, WorkflowJob][] {
  return Object.entries(doc.jobs ?? {});
}

describe('supply chain — pinagem', () => {
  it('toda action de terceiro é pinada por SHA de 40 caracteres', () => {
    const offenders: string[] = [];

    for (const file of workflowFiles()) {
      const { doc } = readWorkflow(file);
      for (const [jobName, job] of allJobs(doc)) {
        // `uses:` no nível do job (reusable workflow) — local (./) é aceito.
        if (job.uses !== undefined && !job.uses.startsWith('./') && !/@[0-9a-f]{40}$/.test(job.uses)) {
          offenders.push(`${file} → job ${jobName}: ${job.uses}`);
        }
        for (const step of job.steps ?? []) {
          if (step.uses === undefined || step.uses.startsWith('./')) continue;
          if (!/@[0-9a-f]{40}$/.test(step.uses)) {
            offenders.push(`${file} → ${jobName} → ${step.uses}`);
          }
        }
      }
    }

    expect(offenders, `actions sem pin por SHA:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('toda imagem Docker usada em `run:` é pinada por digest sha256', () => {
    const offenders: string[] = [];
    // Casa `docker run … imagem[:tag|@digest]` — a imagem é o 1º token que não é flag/valor-de-flag.
    const DIGEST = /@sha256:[0-9a-f]{64}/;

    for (const file of workflowFiles()) {
      const { raw } = readWorkflow(file);
      for (const line of raw.split('\n')) {
        const m = /^\s*([a-z0-9][a-z0-9._/-]*\/[a-z0-9][a-z0-9._/-]*(?::[\w.-]+)?(?:@sha256:[0-9a-f]{64})?)\s*\\?\s*$/.exec(
          line,
        );
        if (m === null) continue;
        const ref = m[1]!;
        // Só interessa referência de imagem: contém '/' e não é caminho de arquivo do repo.
        if (ref.startsWith('.') || ref.startsWith('/')) continue;
        if (!DIGEST.test(ref)) offenders.push(`${file}: ${ref}`);
      }
    }

    expect(offenders, `imagens sem digest:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('supply chain — robustez de execução', () => {
  it('todo job declara timeout-minutes explícito e abaixo do default de 360', () => {
    const offenders: string[] = [];

    for (const file of workflowFiles()) {
      const { doc } = readWorkflow(file);
      for (const [jobName, job] of allJobs(doc)) {
        // O GitHub NÃO honra timeout-minutes em job `uses:` — o timeout tem de estar no
        // workflow chamado. Cobrado lá, não aqui.
        if (job.uses !== undefined) continue;
        const t = job['timeout-minutes'];
        if (t === undefined) offenders.push(`${file} → ${jobName}: sem timeout-minutes`);
        else if (t >= 360) offenders.push(`${file} → ${jobName}: timeout ${t} >= 360`);
      }
    }

    expect(offenders, `jobs sem timeout:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('todo workflow declara permissions no topo (least privilege)', () => {
    const offenders = workflowFiles().filter((f) => readWorkflow(f).doc.permissions === undefined);
    expect(offenders, `workflows sem permissions: ${offenders.join(', ')}`).toEqual([]);
  });

  it('concurrency é chaveada pela BRANCH, nunca por github.ref cru', () => {
    const offenders: string[] = [];

    for (const file of workflowFiles()) {
      const { doc } = readWorkflow(file);
      const group = doc.concurrency?.group;
      if (group === undefined) continue;
      // github.ref difere entre push (refs/heads/x) e o PR do MESMO commit (refs/pull/N/merge):
      // grupos distintos, ambos rodam — dobro de trabalho para o mesmo commit.
      if (group.includes('github.ref}}') || /github\.ref\s*}}/.test(group)) {
        offenders.push(`${file}: group usa github.ref cru → ${group}`);
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
