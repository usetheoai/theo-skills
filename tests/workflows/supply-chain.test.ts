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

/**
 * A imagem de runtime não carrega gerenciador de pacote.
 *
 * MEDIDO em 2026-08-04: o gate Trivy do `publish.yml` reprovou a v0.14.0 com duas CVEs HIGH
 * — `brace-expansion@2.0.2` (CVE-2026-69152) e `ip-address@10.1.0` (CVE-2026-69192). Nenhuma
 * das duas vem do nosso `pnpm-lock.yaml`, que resolve 5.0.6 e 10.3.1. Elas vivem no **npm
 * embutido na imagem base**:
 *
 *   docker run --rm node:22-slim find / -type d -name brace-expansion
 *   → /usr/local/lib/node_modules/npm/node_modules/brace-expansion   (2.0.2)
 *
 * O estágio de runtime nunca chama npm: o CMD é `node`, o healthcheck é `node -e`, e as
 * dependências chegam prontas de outro estágio. Carregar um gerenciador de pacote que
 * ninguém executa é superfície de ataque paga sem contrapartida — e, como se vê, dívida de
 * CVE herdada de terceiro que trava o release por algo que não é nosso.
 *
 * Remover é o fix; um `.trivyignore` seria esconder. A diferença importa: ignorar mantém o
 * binário vulnerável dentro da imagem que roda em produção.
 */
describe('imagem de runtime', () => {
  const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

  const runtimeStage = (): string => {
    const i = dockerfile.indexOf('AS runtime');
    expect(i).toBeGreaterThan(-1);
    // Continuações de linha (`\\` + newline) são juntadas: um `RUN` é UMA instrução, e um
    // teste que só olha a primeira linha reprova a mesma remoção só por estar quebrada.
    return dockerfile.slice(i).replace(/\\\r?\n\s*/g, ' ');
  };

  it.each(['npm', 'yarn', 'corepack'])(
    'remove o %s herdado da imagem base — nenhum é executado em runtime',
    (mgr) => {
      // Só o npm tinha CVE aberta quando isto foi escrito; yarn e corepack estavam limpos.
      // Entram junto porque a dívida é da mesma natureza — binário que ninguém invoca,
      // versionado por terceiro, capaz de travar um release por algo que não é nosso.
      expect(runtimeStage()).toMatch(new RegExp(`rm -rf[^\\n]*\\b${mgr}\\b`));
    },
  );

  it('remove o npm herdado da imagem base — ele nunca é executado em runtime', () => {
    // A remoção precisa acontecer no estágio de runtime; fazê-la num estágio anterior não
    // afeta a imagem final, que parte de `node:22-slim` de novo.
    expect(runtimeStage()).toMatch(/rm -rf[^\n]*\/usr\/local\/lib\/node_modules\/npm/);
  });

  it('a remoção acontece ANTES de USER node — depois disso não há permissão', () => {
    const stage = runtimeStage();
    const rmAt = stage.search(/rm -rf[^\n]*node_modules\/npm/);
    const userAt = stage.indexOf('USER node');
    expect(rmAt).toBeGreaterThan(-1);
    expect(userAt).toBeGreaterThan(-1);
    expect(rmAt).toBeLessThan(userAt);
  });

  it('o runtime continua sem invocar npm/pnpm/corepack — a remoção não pode quebrar nada', () => {
    // Guarda o pressuposto do fix: se um dia o CMD ou o healthcheck passar a usar um
    // gerenciador de pacote, este teste reprova e a remoção precisa ser reavaliada.
    const stage = runtimeStage();
    const cmdAndHealth = stage
      .split('\n')
      .filter((l) => /^(CMD|HEALTHCHECK|ENTRYPOINT)/.test(l.trim()) || /^\s+CMD/.test(l))
      .join('\n');
    expect(cmdAndHealth).not.toMatch(/\b(npm|pnpm|corepack|npx)\b/);
  });
});
