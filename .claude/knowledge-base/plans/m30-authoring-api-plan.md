---
slug: m30-authoring-api
milestone_id: M30
target_project: theo-skills
created_at: 2026-08-03
goal: Dar a qualquer cliente a capacidade de validar uma skill sem publicá-la, e de publicar um SKILL.md sem empacotar.
generated_by: to-plan
source: discoveries/blueprints/m30-authoring-api-discover.md
---

# Plan: M30 — A API da autoria

## Baseline Context (medido no DISCOVER)

| peça | arquivo | estado |
|---|---|---|
| `ingestPayload` | `packages/api/src/server/handlers/skills.ts:72` | privada; serve `POST` (`:203`) e `PATCH` (`:273`) |
| `validateSkillPayload` | `packages/core/src/domain/skill-validation.ts` | core compartilhado — *"so the server and the dev CLI never diverge"* |
| forma da falha do core | `skill-validation.ts:62-69` | **`{ok:false, code, message, details?}`** |
| forma da resposta HTTP | `fail()` em `handlers/skills.ts` | **`{ error: code }`** — `message` e `details` descartados |
| entrada | `decodeBase64Zip` | exige base64 não-vazio; `SKILL.md` avulso é caminho novo |

**O que o baseline muda:** o AC1 já é a arquitetura (caminho compartilhado existe). O AC4 é
menor do que parecia em `{code,message}` e maior em campo-e-linha.

## Coverage Matrix

| # | Critério | Tarefa |
|---|---|---|
| AC1 | mesmo `code` em `:validate` e `POST`, por caminho compartilhado | T2 |
| AC2 | zero efeito colateral, medido por contagem | T3 |
| AC3 | `POST` aceita `SKILL.md` avulso, mesma instrução resolvida | T4 |
| AC4 | erro diz **onde**, além de `{code, message}` | T1 (parte a) + **decisão** (parte b) |
| AC5 | `:validate` exige escopo e é contabilizado | T5 |

## Fases

### Fase 1 — parar de perder o que já existe (habilita o AC4-a)

**T1 — `BoundaryError` preserva `message` e `details`.**
Hoje: `throw new BoundaryError(400, result.code)` descarta os dois; `fail()` responde
`{error: code}`. É o mesmo defeito que o M26 corrigiu no `theo-cloud` — informação útil colapsada
em código único.

*RED:* payload com frontmatter inválido → a resposta carrega `code` **e** `message` não-vazio.
Mutação que discrimina: voltar a `{error: code}` derruba só a asserção de `message`.

> **Cuidado de contrato:** `POST` e `PATCH` hoje respondem `{error}`. Acrescentar campos é
> aditivo e não quebra quem lê `error`; **renomear** `error`→`code` quebraria. O plano ACRESCENTA,
> não renomeia.

### Fase 2 — a rota nova

**T2 — `POST /v1/skills:validate`.** Chama `ingestPayload` e responde `200 {ok:true}` ou o mesmo
erro das rotas de escrita. *RED:* tabela sobre payloads inválidos (frontmatter ausente, versão
malformada, ZIP corrompido) — mesmo `code` nas duas rotas.

**T3 — zero efeito colateral.** *RED:* N chamadas com payload **válido**; `GET /v1/skills`
inalterado, zero jobs enfileirados, zero revisões. Asserção sobre **contagem**, não sobre status —
um `:validate` que gravasse e respondesse 200 passaria em qualquer verificação de resposta.

**T5 — escopo + métrica.** *RED:* sem bearer → `401`; com escopo insuficiente → recusa; contador
incrementa. Ele descomprime entrada arbitrária: sem escopo é porta anônima de CPU.

### Fase 3 — entrada nova

**T4 — `SKILL.md` avulso.** *RED:* publicar o mesmo arquivo pelos dois caminhos (avulso e zipado)
e comparar `GET /v1/skills/:id/instructions` — devem ser idênticos.

## DECISÃO PENDENTE — campo e linha (AC4-b)

`details` é `readonly string[]` livre (hoje: uma linha por finding de segredo). **Não existe
posição estruturada em lugar nenhum**, e produzi-la exige o validador de schema devolver
`{field, line}`.

Duas saídas, e é decisão do dono:

| | custo | consequência |
|---|---|---|
| **incluir no M30** | alto — mexe no core, no schema e nos testes | AC4 fecha completo |
| **separar** | baixo | M30 entrega `{code, message}`; campo-e-linha vira milestone próprio, e o AC4 **não fecha** — o M30 não é aceitável até isso ser decidido |

**Não decido sozinho:** a segunda opção deixa um critério da DoD aberto, e mudar a DoD para
acomodá-la seria a violação que o `cycle-goal` nomeia.

## Drawbacks & Risks

1. **`:validate` é bomba de descompressão.** Rota sem escrita convida volume ao caminho de unzip.
   *Mitigação:* teto do tamanho **descomprimido**, não do corpo recebido; o teste mede que a
   recusa acontece **sem** inchar a memória.
2. **Verde no dry-run ≠ publish bem-sucedido.** O `:validate` vê forma; o publish vê forma **e**
   estado (nome tomado, versão repetida, cota) — e o estado muda entre os dois (TOCTOU).
   *Mitigação:* o contrato declara o que não cobre.
3. **Acrescentar campos ao erro é aditivo; renomear não é.** Ver T1.

## Unresolved Questions

1. **Campo e linha entram no M30?** (bloqueia o AC4 — ver § DECISÃO PENDENTE)
2. **`:validate` cobra o mesmo escopo que `POST`?** Validar não escreve; exigir `skills:write`
   impediria um leitor de conferir antes de pedir permissão. Sugiro escopo de leitura + limite.

## Dependencies

Nenhuma nova. `validateSkillPayload` e `ingestPayload` já existem; sem superfície nova para
`deps-audit`.

## Prior Art

- `discoveries/blueprints/m30-authoring-api-discover.md` — o baseline medido
- `theo-cloud/internal/skills/upstream_error.go` (M26) — o padrão de preservar em vez de colapsar
