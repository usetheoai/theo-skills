---
slug: m10-cicd-supply-chain
milestone_id: M10
target_project: theo-skills
created_at: 2026-07-30
goal: Dar ao repositório CI/CD com supply chain verificável e a papelada OSS mínima, espelhando o padrão do theo-memory, provado por um PR que falha quando um teste quebra.
generated_by: to-plan
source: knowledge-base/discoveries/blueprints/m10-cicd-supply-chain-blueprint.md
---

# Plan: M10 — CI/CD, supply chain e prontidão OSS

## Goal

Sair de **zero workflows** para um pipeline que: (a) roda lint + typecheck + build + testes
em todo PR e push no trunk, (b) varre segredos e OWASP, (c) valida os próprios workflows,
(d) publica imagem assinada em GHCR atrás de gates encadeados, e (e) tem a papelada OSS
mínima. Tudo com actions pinadas por SHA e imagens por digest.

## Baseline Context

Repo @ `3235ed3`. Monorepo pnpm 11.1.0, Node `>=20`, 5.483 LoC em `packages/*/src`.

### Estado medido (2026-07-30)

| Fato | Valor | Como foi medido |
|---|---|---|
| Workflows | **0** | `ls .github/workflows` → inexistente |
| `pnpm test` sem banco | **verde, ~11s** | execução real: core + api (17 arq / 74 testes) + cli (8 / 46) |
| Suíte contract abre `Pool`? | **não** | `api.contract.test.ts:9` → `fakePool = {} as unknown as Pool` (só o tipo) |
| `Dockerfile` | ausente | `test -e` |
| `vitest.e2e.config.ts` | ausente | `find` — o README promete E2E que não existe |
| LICENSE · SECURITY · NOTICE · CONTRIBUTING · CODE_OF_CONDUCT | ausentes | `test -e` |
| Scripts raiz | `typecheck lint test test:integration build db:push db:generate compose:up compose:down start test:fast` | `package.json` |

### Arquivos que serão criados

| Arquivo | Papel |
|---|---|
| `.github/workflows/ci.yml` | gate rápido: build → lint → typecheck → test |
| `.github/workflows/actionlint.yml` | valida os workflows + shellcheck dos `run:` |
| `.github/actionlint.yaml` | declara labels de runner não-GitHub (vazio hoje, ver ADR-1) |
| `.github/workflows/security-sast.yml` | semgrep (OWASP) + gitleaks na raiz |
| `.gitleaks.toml` | config do scan de segredos |
| `.github/workflows/integration.yml` | suítes contra Postgres real + schedule |
| `.github/workflows/publish.yml` | imagem GHCR atrás de `gate-ci` + `gate-integration` |
| `.github/workflows/build-publish.yml` | vendorizado (trivy + cosign) |
| `Dockerfile` · `.dockerignore` | runtime multi-stage |
| `vitest.e2e.config.ts` | config E2E que o README já promete |
| `tests/workflows/*.test.ts` | **testes dos workflows** (invariantes travados) |
| `LICENSE` `NOTICE` `SECURITY.md` `CONTRIBUTING.md` `CODE_OF_CONDUCT.md` | prontidão OSS |

### Glossário

- **Gate encadeado** — `publish.yml` invoca `ci.yml` via `uses:` como job, em vez de confiar que o CI rodou antes naquele commit.
- **Pin por SHA** — `uses: org/action@<sha40>` com a tag em comentário; tag é mutável, SHA não.
- **Type-aware lint** — regras `@typescript-eslint/no-unsafe-*` que precisam dos `.d.ts` em `dist/`; sem build antes, acusam erro em código intocado.

### Fronteiras de arquitetura afetadas

Nenhuma fronteira de código: M10 não toca `packages/*/src`. Toca raiz, `.github/` e adiciona
`tests/workflows/` (suíte nova, na raiz, seguindo a convenção de `tests/` do Theo
Architecture Standard § 4).

## Prior Art & Related Work

- **Blueprint M10** (`knowledge-base/discoveries/blueprints/m10-cicd-supply-chain-blueprint.md`) — 11 padrões extraídos dos 8 workflows do theo-memory, com 3 ADRs.
- **theo-memory** — implementação de referência; `ci.yml:76-97` documenta a ordem Build→Lint com o run medido (30306550640).
- **Umbrella CLAUDE.md § Runbook** — as duas pré-condições da Blacksmith (org + GitHub App), motivo do ADR-1.

## Coverage Matrix

| # | Afirmação do Goal | Task(s) | Verificação |
|---|---|---|---|
| 1 | lint + typecheck + build + testes em PR e push | T1.1 | `ci.yml` existe, roda os 4, ordem Build→Lint travada por teste |
| 2 | varre segredos e OWASP | T1.3 | `security-sast.yml` + `.gitleaks.toml`; scan cobre a raiz |
| 3 | valida os próprios workflows | T1.2 | `actionlint.yml` verde sobre todos os arquivos |
| 4 | imagem assinada em GHCR atrás de gates | T4.1, T4.2 | `publish.yml` com `gate-ci`; cosign com identidade do próprio repo |
| 5 | papelada OSS mínima | T3.1, T3.2 | 5 arquivos presentes |
| 6 | actions por SHA, imagens por digest | T5.1 | **teste** falha se qualquer `uses:` não for SHA de 40 chars |
| 7 | PR falha quando um teste quebra | T6.1 | PR real com teste quebrado → check vermelho (evidência anexada) |
| 8 | Dockerfile + config E2E | T2.1, T2.2 | build da imagem OK; `vitest.e2e.config.ts` executável |

**Cobertura: 8/8 (100%).**

## Tasks

### Fase 1 — Gates de verificação

#### T1.1 — `ci.yml` (gate rápido, sem banco)

#### Why this step
É o gate que falta há mais tempo e o que mais barato mata defeito. Vem primeiro porque
`publish.yml` (T4.1) o invoca por `uses:`.

#### TDD
```
test_ci_workflow_builds_before_lint:
  arrange: parse .github/workflows/ci.yml
  act:     índices dos steps 'Build' e 'Lint' no job static
  assert:  indexOf('Build') < indexOf('Lint')
test_ci_workflow_has_explicit_timeout:
  assert:  todo job tem timeout-minutes, e < 60
test_ci_concurrency_keyed_by_branch:
  assert:  group contém 'head.ref || github.ref_name', NÃO 'github.ref'
```

**DoD:** roda `pnpm install --frozen-lockfile`, `build`, `lint`, `typecheck`, `test`;
`permissions: contents: read`; `paths-ignore` para `.claude/**`, `**/*.md`, `docs/**`;
`workflow_call` habilitado.

#### T1.2 — `actionlint.yml` + `.github/actionlint.yaml`

#### Why this step
Sem ele, um erro de sintaxe em workflow só aparece quando o workflow roda — tarde demais.

#### TDD
```
test_actionlint_image_pinned_by_digest:
  assert:  a imagem rhysd/actionlint é referenciada por @sha256:, nunca por :latest
```

**DoD:** `docker run` com imagem por digest; verde sobre todos os workflows do repo.

#### T1.3 — `security-sast.yml` + `.gitleaks.toml`

#### Why this step
O repo vai abrir; segredo commitado depois de aberto é incidente, não bug.

#### TDD
```
test_sast_scans_repo_root_not_only_packages:
  assert:  o comando gitleaks aponta para /src (raiz), não /src/packages
test_sast_uses_docker_run_not_container_job:
  assert:  nenhum job do arquivo declara `container:`
```

**DoD:** semgrep com `p/typescript p/javascript p/owasp-top-ten --error`; gitleaks na raiz
com `--exit-code 1`; ambas as imagens por digest.

### Fase 2 — Runtime e E2E

#### T2.1 — `Dockerfile` multi-stage + `.dockerignore`

#### Why this step
Exigido pelo Theo Architecture Standard § 5 e pré-requisito de `publish.yml`.

#### TDD
```
test_dockerfile_node_major_matches_ci:
  assert:  o major do FROM node: é o mesmo do node-version do ci.yml
  # padrão 10 do blueprint: testar num major diferente do que se publica é
  # como um worker morto chegar ao host com a esteira verde
```

**DoD:** build local OK; imagem sobe e responde `/v1/health`.

#### T2.2 — `vitest.e2e.config.ts` + primeiro E2E

#### Why this step
O README promete E2E ("criar → recuperar por busca → obter revisão") que não existe. Promessa
sem cobertura é dívida com juros.

#### TDD
```
test_e2e_config_is_executable:
  assert:  `vitest run --config vitest.e2e.config.ts` sai 0 (com banco) e não 'no config'
```

**DoD:** config na raiz + ao menos um E2E do fluxo crítico rodando contra o compose.

### Fase 3 — Prontidão OSS

#### T3.1 — `LICENSE` + `NOTICE`

#### Why this step
Sem licença explícita, o repo é "all rights reserved" por default — ninguém pode usar, e o
peer que clonamos study-only nos julgaria pelo mesmo critério.

**DoD:** licença alinhada com a do ecossistema (verificar a do theo-memory antes de escolher);
`NOTICE` com atribuições de terceiros.

#### T3.2 — `SECURITY.md` + `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`

**DoD:** canal de reporte de vulnerabilidade, fluxo de contribuição (`workspace → develop`),
código de conduta.

### Fase 4 — Publicação

#### T4.1 — `build-publish.yml` vendorizado

#### Why this step
O reusable original vive em `usetheodev/theo` (privado, outro dono) — chamar de fora morre
no PARSE. Vendorizar é a única via até a consolidação de org.

#### TDD
```
test_vendored_publish_has_return_path_documented:
  assert:  o arquivo contém o caminho de volta ao reusable e o repo alvo
test_cosign_identity_matches_this_repo:
  assert:  --certificate-identity-regexp referencia theo-skills, não outro repo
  # guard de confused-deputy: identidade errada ACEITA assinatura de outro workflow
```

**DoD:** trivy escaneia a imagem; cosign assina keyless; `timeout-minutes` no job chamado
(o GitHub não honra em `uses:`).

#### T4.2 — `publish.yml` com gates encadeados

#### TDD
```
test_publish_invokes_ci_as_gate:
  assert:  existe job com `uses: ./.github/workflows/ci.yml`
test_publish_never_runs_on_pull_request:
  assert:  'pull_request' não está nos gatilhos
  # o reusable SEMPRE dá push da imagem; rodar em PR publicaria codigo nao mergeado
```

### Fase 5 — Invariantes travados

#### T5.1 — Suíte `tests/workflows/`

#### Why this step
Workflow é código e sofre regressão como código. O theo-memory aprendeu isso do jeito
difícil (a cópia vendorizada travada por teste). Sem esta suíte, o pin por SHA degrada para
`@v4` no primeiro PR apressado.

#### TDD
```
test_every_action_pinned_by_40char_sha:
  arrange: todo `uses:` de todos os workflows, exceto os locais (./)
  assert:  casa /@[0-9a-f]{40}( |$)/ — falha em @v4, @main, @latest
test_every_docker_image_pinned_by_digest:
  assert:  toda imagem em `docker run` casa /@sha256:[0-9a-f]{64}/
test_every_job_has_timeout:
  assert:  todo job de todo workflow declara timeout-minutes
```

**DoD:** suíte roda no próprio `ci.yml` (auto-verificação).

### Fase 6 — Prova do gate

#### T6.1 — PR que prova o gate

#### Why this step
DoD do milestone exige **"um PR de teste falha o merge quando um teste quebra"**. Gate não
provado é gate presumido.

**DoD:** PR com um teste deliberadamente quebrado → check vermelho, evidência (URL do run +
conclusion) anexada ao implementation log; PR fechado sem merge; segundo PR com o mesmo
código correto → verde.

## Dependencies

Nenhuma dependência de milestone. Dependências externas: `gh` autenticado, Docker local
para validar o Dockerfile.

## Drawbacks & Risks

1. **`ubuntu-latest` é mais lento que a frota efêmera** e não tem o cache da Blacksmith. Aceito: a alternativa (label Blacksmith sem org) produz fila infinita silenciosa. Custo real: alguns minutos por run.
2. **Cópia vendorizada de `build-publish.yml` diverge do original com o tempo.** Mitigação: T4.1 exige o caminho de volta documentado no próprio arquivo + teste que o trava.
3. **`pnpm audit` pode ficar vermelho por CVE transitiva sem fix disponível**, travando o CI por algo fora do nosso controle. Mitigação: `audit` entra como job separado e não-bloqueante nesta fase; promover a bloqueante é decisão de M17 com allowlist.
4. **Semgrep OWASP pode gerar falso positivo** em código legítimo. Mitigação: `--error` só nas regras dos três packs; supressão exige comentário justificado, nunca desabilitar o pack.

## Unresolved Questions

1. **Qual licença?** O theo-memory tem `LICENSE` + `NOTICE`; preciso ler qual antes de escolher — o ecossistema deve ser coerente. *Resolvo lendo, não perguntando.*
2. **`integration.yml` roda no schedule desde já?** O theo-memory roda 03:00 UTC. Com Postgres em service container é barato; mantenho.

## Test Plan

| Camada | O que cobre | Onde |
|---|---|---|
| Unit (workflows) | pin por SHA, digest, timeout, ordem Build→Lint, concurrency, gates | `tests/workflows/*.test.ts` |
| Integração | suítes existentes contra Postgres real | `integration.yml` |
| E2E | criar → buscar → obter revisão | `vitest.e2e.config.ts` |
| Prova de gate | PR com teste quebrado falha | T6.1, evidência no log |

## ADRs

Herdados do blueprint (ADR-M10-1 `ubuntu-latest`, ADR-M10-2 `pnpm test` no gate rápido —
**agora provado empiricamente**, ADR-M10-3 sem npm nesta fase).

### ADR-M10-4 — Workflows têm teste

**Contexto:** infra-as-code costuma ficar sem cobertura; o pin por SHA degrada silenciosamente.
**Decisão:** `tests/workflows/` valida os invariantes (SHA, digest, timeout, ordem, gates).
**Alternativas rejeitadas:** (a) confiar no actionlint — ele valida sintaxe, não política de
supply chain; (b) revisão humana — não escala e falha no PR apressado.
**Consequência:** um PR que troque `@sha` por `@v4` fica vermelho.
