---
slug: m10-cicd-supply-chain
milestone_id: M10
date: 2026-07-30
generated_by: discover (deep research)
sources:
  - theo-memory/.github/workflows/{ci,integration,security-sast,actionlint,publish,publish-npm,eval,build-publish}.yml
  - theo-memory/.github/actionlint.yaml
  - theo-memory/docs/ARCHITECTURE.md (Theo Architecture Standard)
verdict: SHIPPABLE
---

# Blueprint M10 — CI/CD, supply chain e prontidão OSS

## Pergunta de pesquisa

Como um repositório do ecossistema Theo constrói seu CI/CD, e o que exatamente o
`theo-skills` precisa replicar — considerando que ele tem **zero workflows** hoje?

## Fonte normativa

`theo-memory` é a implementação de referência (8 workflows, 1.356 linhas de YAML com o
raciocínio documentado inline). Cada padrão abaixo foi lido no arquivo, não inferido.

## Coverage Corner 1 — Integração / gates

| Workflow | Gatilho | O que prova |
|---|---|---|
| `ci.yml` | PR → develop/main · `workflow_call` | lint + typecheck + build, **sem banco** |
| `integration.yml` | idem + `schedule` 03:00 UTC | suítes contra Postgres real |
| `security-sast.yml` | PR + push develop | semgrep (OWASP) + gitleaks |
| `actionlint.yml` | PR + push develop | os próprios workflows + shellcheck dos `run:` |
| `publish.yml` | push develop + tag `v*` | imagem GHCR, atrás de gates encadeados |

**Gates encadeados** — `publish.yml` não confia em "o CI passou antes": ele **invoca**
`uses: ./.github/workflows/ci.yml` como job (`gate-ci`, `gate-contract`). Publicar sem o
gate ter rodado *naquele commit* é impossível por construção.

## Coverage Corner 2 — Dependências / supply chain

**Toda action pinada por SHA de commit, com a versão em comentário:**

```yaml
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
```

**Toda imagem Docker pinada por digest** — `rhysd/actionlint@sha256:b1934…`,
`semgrep/semgrep@sha256:98c25…`, `ghcr.io/gitleaks/gitleaks@sha256:c00b6…`. A justificativa
está escrita no arquivo: *"um `:latest` num gate de segurança/qualidade é a mesma classe de
risco de supply-chain"*.

`build-publish.yml` acrescenta **trivy** (scan da imagem) e **cosign** (assinatura keyless).

## Coverage Corner 3 — Ferramentas

`pnpm/action-setup` (versão fixa) · `actions/setup-node` com `cache: pnpm` ·
`docker/{setup-qemu,setup-buildx,metadata,build-push}-action` · `aquasecurity/trivy-action` ·
`sigstore/cosign-installer`.

## Coverage Corner 4 — Técnicas (os 11 padrões a replicar)

1. **`permissions: contents: read`** explícito no topo — least privilege por default.
2. **`concurrency` chaveada pela BRANCH**, não por `github.ref`:
   `group: ci-${{ github.event.pull_request.head.ref || github.ref_name }}`.
   *Defeito que previne:* push em `develop` e o PR do mesmo commit têm `github.ref`
   diferentes, caem em grupos distintos e **ambos rodam** — dobro de trabalho.
3. **`timeout-minutes` explícito em todo job.** O default é 360 min; um hang segura a fila.
4. **`Build` ANTES de `Lint`.** Medido (run 30306550640): lint antes do build acusou 14
   erros `@typescript-eslint/no-unsafe-*` em código intocado, porque essas regras são
   **type-aware** e, sem `dist/`, imports entre pacotes do workspace resolvem para `any`.
5. **Dois gatilhos, não um.** PR mata o defeito antes do trunk; push pós-merge pega o
   conflito semântico que só existe depois do merge. Escopos diferentes, não redundância.
6. **`paths-ignore`** para `.claude/**`, `**/*.md`, `docs/**` — no CI, não no SAST.
7. **SAST roda na RAIZ, não só em `packages/`.** O gitleaks do theo-memory lia só
   `/src/packages` enquanto a justificativa dizia "prosa é onde credencial vaza" —
   *"gate cuja justificativa não corresponde ao que ele faz é pior que gate ausente"*.
8. **`docker run`, nunca `container:` no job.** Um job com `container:` roda **todo** step
   como root — inclusive o checkout — deixando arquivos root-owned que quebram o próximo job.
9. **Escopo honesto do gate rápido.** `ci.yml` deliberadamente **não** roda `pnpm test`:
   parte da suíte "contract" do theo-memory abre `Pool` real e vazaria `ECONNREFUSED` sem
   banco. *"Vermelho por falta de infraestrutura, não por defeito — o pior tipo de gate."*
10. **Node do CI casa o runtime da imagem** (Dockerfile). Testar num major diferente do que
    se publica é como um worker morto chegar ao host com a esteira verde.
11. **`.github/actionlint.yaml`** declarando labels de runner não-GitHub — sem ele, o gate
    rejeita a si mesmo e a todos os outros arquivos.

## ADRs derivados para o theo-skills

### ADR-M10-1 — `ubuntu-latest`, não Blacksmith

O theo-memory usa `blacksmith-8vcpu-ubuntu-2404`. **O theo-skills não pode**: a Blacksmith
serve apenas repositórios de **organização**, e `usetheodev/theo-skills` está numa conta
pessoal. Aplicar a label antes da transferência deixa o job **`queued` para sempre, sem
erro** — medido no `theo-traefik-mcp` (>24h em fila).

**Decisão:** `runs-on: ubuntu-latest`. Migração para Blacksmith é trabalho de transferência
de org (runbook do umbrella), não deste milestone.
**Alternativa rejeitada:** aplicar a label agora — produz fila infinita silenciosa.
**Consequência:** `.github/actionlint.yaml` fica desnecessário agora, mas é criado mesmo
assim, vazio-com-comentário, para a migração futura não precisar redescobrir a armadilha.

### ADR-M10-2 — `pnpm test` ENTRA no gate rápido

O theo-memory exclui `pnpm test` do `ci.yml` porque a suíte dele abre `Pool` real. **A do
theo-skills não abre**: `vitest.contract.config.ts` roda 11 testes co-locados no `core` e 32
em `api/tests/contract`, todos sem I/O.

**Decisão:** o gate rápido do theo-skills roda `pnpm test`. Copiar a exclusão do theo-memory
seria cargo cult — a razão dela não existe aqui.
**Verificação:** se algum teste contract exigir banco, ele migra para `integration.yml`.

### ADR-M10-3 — Sem `publish-npm.yml` neste milestone

Publicar pacote npm exige decidir o que é público (`core`? `cli`?) e configurar Trusted
Publishing. É escopo de M16 (SDK), não de M10.
**Decisão:** M10 entrega imagem em GHCR; npm fica para quando houver pacote a publicar.

## Riscos medidos

1. **Reusable `build-publish.yml` vive em `usetheodev/theo`** (privado, outro dono). O
   GitHub só compartilha reusable privado **dentro do mesmo dono** — chamar de outro repo
   morre no PARSE (`workflow was not found`), sem criar job. Mitigação: vendorizar, como o
   theo-memory fez, com o caminho de volta documentado.
2. **Cosign com identidade errada aceita assinatura de outro workflow.** O
   `--certificate-identity-regexp` deriva de repo + path do workflow; apontar para o repo
   errado quebra o guard de confused-deputy. Mitigação: derivar do próprio repo.

## O que este blueprint NÃO cobre

- Migração para Blacksmith (depende de transferência de org — decisão fora do repo).
- Publicação npm (M16).
- `eval.yml` — o theo-skills tem `packages/api/eval/` mas o gate de Recall@5 pertence a M17.
