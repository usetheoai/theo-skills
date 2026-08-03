/**
 * Invariantes dos gates — a política que o actionlint não vê.
 *
 * Cada teste aqui corresponde a um defeito real documentado no theo-memory ou no blueprint
 * do M10. Nenhum é preferência de estilo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = process.cwd();
const wf = (name: string): string => join(ROOT, '.github/workflows', name);
const readRaw = (name: string): string => readFileSync(wf(name), 'utf8');
// `on:` é YAML 1.1 truthy — o parser devolve a chave `true`. Normalizamos aqui.
const readDoc = (name: string): Record<string, any> => parse(readRaw(name)) as Record<string, any>;
const triggers = (doc: Record<string, any>): Record<string, unknown> =>
  (doc['on'] ?? doc[true as unknown as string] ?? {}) as Record<string, unknown>;

describe('ci.yml — gate rápido', () => {
  it('roda Build ANTES de Lint', () => {
    // DEFEITO QUE ISTO PREVINE (theo-memory ci.yml:82-95, run 30306550640): lint antes do
    // build acusou 14 erros `no-unsafe-*` em código intocado. As regras são TYPE-AWARE e,
    // sem `dist/`, imports entre pacotes do workspace resolvem para `any`.
    const steps = (readDoc('ci.yml').jobs.static.steps as { name?: string }[]).map((s) => s.name ?? '');
    const build = steps.findIndex((n) => /^build$/i.test(n));
    const lint = steps.findIndex((n) => /^lint$/i.test(n));

    expect(build, 'step Build não encontrado').toBeGreaterThanOrEqual(0);
    expect(lint, 'step Lint não encontrado').toBeGreaterThanOrEqual(0);
    expect(build, 'Build tem de vir antes de Lint').toBeLessThan(lint);
  });

  it('exercita os quatro gates sem banco: build, lint, typecheck, test', () => {
    const runs = (readDoc('ci.yml').jobs.static.steps as { run?: string }[])
      .map((s) => s.run ?? '')
      .join('\n');

    for (const gate of ['build', 'lint', 'typecheck', 'test']) {
      expect(runs, `gate ausente: ${gate}`).toMatch(new RegExp(`pnpm[^\\n]*\\b${gate}\\b`));
    }
  });

  it('é invocável como reusable (publish.yml depende disso)', () => {
    expect(triggers(readDoc('ci.yml'))).toHaveProperty('workflow_call');
  });
});

describe('security-sast.yml — escopo do scan', () => {
  it('o scan de segredos cobre a RAIZ, não apenas packages/', () => {
    // theo-memory: "gate cuja justificativa não corresponde ao que ele faz é pior que gate
    // ausente" — o scan lia só /src/packages enquanto dizia cobrir prosa.
    const raw = readRaw('security-sast.yml');
    const gitleaks = raw.split('\n').filter((l) => l.includes('gitleaks') || l.includes('dir /src'));
    expect(gitleaks.join('\n')).toMatch(/dir\s+\/src(\s|$)/);
    expect(gitleaks.join('\n'), 'scan restrito a packages/').not.toMatch(/\/src\/packages/);
  });

  it('nenhum job usa `container:` (deixaria arquivos root-owned no workspace)', () => {
    const jobs = Object.entries(readDoc('security-sast.yml').jobs as Record<string, { container?: unknown }>);
    const offenders = jobs.filter(([, j]) => j.container !== undefined).map(([n]) => n);
    expect(offenders, `jobs com container:: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('publish.yml — gates encadeados', () => {
  it('invoca o ci.yml como job, em vez de confiar que rodou antes', () => {
    const jobs = Object.values(readDoc('publish.yml').jobs as Record<string, { uses?: string }>);
    expect(jobs.some((j) => j.uses === './.github/workflows/ci.yml')).toBe(true);
  });

  it('NUNCA dispara em pull_request', () => {
    // O reusable de build SEMPRE dá push da imagem — não há modo build-only. Rodar em PR
    // publicaria artefato de código não mergeado.
    expect(triggers(readDoc('publish.yml'))).not.toHaveProperty('pull_request');
  });

  it('a identidade do cosign referencia ESTE repositório', () => {
    // Guard de confused-deputy: a identidade keyless deriva de repo + path do workflow.
    // Apontar para outro repo faz a verificação ACEITAR assinatura produzida por outro
    // workflow — pior que não verificar.
    const raw = existsSync(wf('build-publish.yml')) ? readRaw('build-publish.yml') : readRaw('publish.yml');
    // O valor é um regexp entre aspas simples e CONTÉM barras invertidas (`github\.com`);
    // casar até o fecha-aspas é a única leitura correta.
    const identity = /--certificate-identity-regexp\s+'([^']+)'/.exec(raw);
    expect(identity, 'cosign sem --certificate-identity-regexp').not.toBeNull();
    expect(identity![1], 'a identidade aponta para outro repositório').toContain('theo-skills');
  });
});

describe('Dockerfile — coerência com o CI', () => {
  it('o major do Node casa o do ci.yml', () => {
    // Testar num major diferente do que se publica é como um worker morto chegar ao host
    // de dev com a esteira verde.
    const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
    const fromMajor = /FROM\s+node:(\d+)/.exec(dockerfile);
    expect(fromMajor, 'FROM node:<major> não encontrado').not.toBeNull();

    const setupNode = (readDoc('ci.yml').jobs.static.steps as { with?: { 'node-version'?: number | string } }[])
      .map((s) => s.with?.['node-version'])
      .find((v) => v !== undefined);
    expect(setupNode, 'node-version não declarado no ci.yml').toBeDefined();
    expect(String(setupNode)).toBe(fromMajor![1]);
  });
});

describe('o publish não pode liberar imagem sobre integração não verificada', () => {
  it('o job `image` depende do gate de INTEGRAÇÃO, não só do gate sem banco', () => {
    // Medido em 2026-08-01: `image` dependia apenas de `gate-ci`, que roda
    // build+lint+typecheck+test SEM BANCO. Some com o outro defeito da mesma data — a suíte
    // de integração pulava 240 testes em silêncio e saía 0 — e o resultado é um gate que,
    // por construção, NÃO CONSEGUE reprovar regressão de integração. O reconciliador leva a
    // imagem ao app-dev a cada ~5 min.
    //
    // Fazer o script de teste falhar alto era necessário e não suficiente: enquanto o publish
    // não roda integração, publicar sobre integração quebrada continua possível. A forma
    // correta é a do theo-lens, cujo `image` declara os gates todos em `needs` — e cujo gate
    // de contrato reprovou um publish de verdade em 2026-08-01 18:11, com `image: skipped`.
    const publish = readFileSync(wf('publish.yml'), 'utf8');
    const doc = parse(publish) as { jobs: Record<string, { needs?: string[] | string }> };
    const needs = doc.jobs['image']?.needs ?? [];
    const lista = Array.isArray(needs) ? needs : [needs];

    expect(lista, 'o gate sem banco continua exigido').toContain('gate-ci');
    expect(lista, 'e o de integração também — senão o portão não mede o que quebra').toContain(
      'gate-integration',
    );
  });

  it('o gate de integração RODA — não herda o `skipped` do guard de release', () => {
    // Medido no run 30712454039: `gate-integration: skipped`. O `needs` estava lá e o teste
    // anterior passava, mas o job NÃO RODOU — `guard-release-on-main` só roda em tag, e um
    // job cujo `needs` foi pulado é pulado junto, salvo `if: always()`.
    //
    // O `gate-ci` tem essa condição desde sempre; eu copiei o `needs` e não o `if`. A correção
    // PARECIA feita: teste verde, dependência declarada, e o portão sem rodar — exatamente o
    // formato de falha que este item existe para fechar.
    const doc = parse(readFileSync(wf('publish.yml'), 'utf8')) as {
      jobs: Record<string, { if?: string }>;
    };
    const cond = doc.jobs['gate-integration']?.if ?? '';
    expect(cond, 'sem `always()` o gate herda o skip do guard e nunca roda').toContain('always()');
    expect(cond, 'e precisa aceitar o guard pulado, que é o caso normal fora de tag').toContain(
      "'skipped'",
    );
  });

  it('o gate de integração do publish roda a suíte de verdade, com banco', () => {
    const integration = readFileSync(wf('integration.yml'), 'utf8');
    expect(integration, 'precisa ser chamável pelo publish').toContain('workflow_call');
    expect(integration, 'e precisa de um Postgres — sem ele a suíte pula tudo').toMatch(/postgres/i);
  });
});

describe('a condição do `image` precisa VETAR por cada gate, não só declarar `needs`', () => {
  it('exige `result == success` de TODOS os gates que declara em `needs`', () => {
    // O DEFEITO, e é a terceira vez que a mesma classe aparece nesta correção: com
    // `always()` o `needs` PARA DE VETAR. O job roda mesmo com dependência falha, e o único
    // veto passa a ser o `result` checado explicitamente na condição. Eu declarei
    // `needs: [gate-ci, gate-integration]` e checava só o `gate-ci` — então o gate de
    // integração existia no grafo, aparecia verde no run, e NÃO impedia a imagem de subir
    // com a integração vermelha.
    //
    // `always()` é necessário aqui por outra razão (o guard de release é `skipped` fora de
    // tag, e o skip se propaga pela cadeia). O preço de usá-lo é este: cada gate precisa ser
    // vetado à mão. Este teste é o que impede a próxima adição de `needs` de esquecer.
    const doc = parse(readFileSync(wf('publish.yml'), 'utf8')) as {
      jobs: Record<string, { needs?: string[] | string; if?: string }>;
    };
    const image = doc.jobs['image'];
    const needs = Array.isArray(image?.needs) ? image.needs : image?.needs !== undefined ? [image.needs] : [];
    const cond = image?.if ?? '';

    expect(needs.length, 'o job declara gates').toBeGreaterThan(0);
    if (cond.includes('always()')) {
      for (const gate of needs) {
        expect(cond, `\`${gate}\` está em needs mas a condição não o veta`).toContain(
          `needs.${gate}.result == 'success'`,
        );
      }
    }
  });
});


describe('o artefato publicado é EXECUTADO antes de a tag mover', () => {
  // DEFEITO QUE ISTO PREVINE (2026-08-02, 27h de indisponibilidade em dev, issue #122):
  // `packages/api/src/server/handlers/skills.ts` importava `yazl`, declarado em
  // `devDependencies`. No monorepo resolvia por hoisting, através do `packages/cli`, que o
  // declara em `dependencies`. O estágio `production-deps` do Dockerfile roda
  // `pnpm install --prod`: as devDependencies somem, o symlink nunca é criado, e o processo
  // morre no boot com ERR_MODULE_NOT_FOUND — com o pacote FISICAMENTE presente na imagem, em
  // `/app/node_modules/.pnpm/yazl@3.3.1`.
  //
  // Build, lint, typecheck e a suíte inteira passaram: todos rodam na árvore de
  // desenvolvimento, onde a devDependency existe. O pipeline publicava um artefato que nunca
  // tinha sido executado, e o Trivy só examina conteúdo — não levanta o processo.

  it('build-publish roda um smoke na imagem carregada ANTES do push', () => {
    const doc = readDoc('build-publish.yml');
    const steps = (doc.jobs['build-publish'].steps as { name?: string; run?: string }[]).map(
      (s) => ({ name: s.name ?? '', run: s.run ?? '' }),
    );

    const smoke = steps.findIndex((s) => /smoke/i.test(s.name));
    const push = steps.findIndex((s) => /build \+ push/i.test(s.name));

    expect(smoke, 'step de smoke não encontrado em build-publish.yml').toBeGreaterThanOrEqual(0);
    expect(push, 'step de push não encontrado').toBeGreaterThanOrEqual(0);
    expect(smoke, 'o smoke tem de rodar ANTES do push — depois, a tag já moveu').toBeLessThan(
      push,
    );

    // O smoke precisa REPROVAR em falha de resolução de módulo. Sem esta asserção o step
    // poderia virar um `docker run` que ignora a saída e reporta verde.
    expect(
      steps[smoke]?.run,
      'o smoke tem de detectar ERR_MODULE_NOT_FOUND e sair diferente de zero',
    ).toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(steps[smoke]?.run, 'o smoke tem de falhar o job (exit 1)').toMatch(/exit 1/);
  });

  it('ci.yml exige que todo import de produção esteja em dependencies', () => {
    const runs = (readDoc('ci.yml').jobs.static.steps as { run?: string }[])
      .map((s) => s.run ?? '')
      .join('\n');

    expect(runs, 'check-declared-deps.mjs não é executado no CI').toMatch(
      /check-declared-deps\.mjs/,
    );
    expect(existsSync(join(ROOT, 'scripts/check-declared-deps.mjs')), 'script ausente').toBe(true);
  });
});
