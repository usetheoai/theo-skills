---
slug: skills-authoring-api
generated_by: roadmap-feature
date: 2026-08-03
status: completed
questions_answered: 4
target_roadmap: theo-skills/ROADMAP.md
new_milestone_id: M30
---

# Grill — a API da autoria de skills

## Pré-flight (Step 0)

30 milestones; abertos: M7 `[ ]`, M28 `[ ]`, M29 `[→]` (ponteiro). Próximo id livre: **M30**.
Árvore limpa. Fora-de-escopo cruzado: nenhum colide — o texto declara *"armazenamos e
descobrimos"*, então descoberta e autoria são o núcleo, não extensão.

## Q1/4 — o que é, e por que agora

**Pergunta:** o que é este milestone e o que mudou para justificá-lo agora?

**Medições que fundamentaram (2026-08-03):**

| fato | evidência |
|---|---|
| a jornada entregue é só leitura | naveguei o `app-dev` clicando: lista → detalhe → versões/canais → promoção |
| a API expõe 12 rotas de leitura; a tela consome 6 | `:retrieve`, `revisions`, `provenance`, `visibility` sem consumidor |
| **toda a escrita já existe** | `POST /v1/skills`, `PATCH`, `DELETE`, `PUT channels`, `PUT visibility` |
| **`/v1/operations/:id` existe** | a tela pode acompanhar sem webhook (que o navegador não recebe) |
| **não há validação prévia** | nenhum `:validate` / dry-run — para saber se está certo, você **publica** |
| criar exige ZIP | `ingestPayload(deps, body.zippedFilesystem)`; a maioria das skills é um `SKILL.md` só |

**Resposta (escolhida pelo dono):** M30 entrega **a API da autoria** — o que falta para
QUALQUER cliente (CLI, tela, MCP) autorar sem publicar às cegas:

- `POST /v1/skills:validate` — dry-run com os mesmos erros tipados, zero efeito colateral;
- `POST /v1/skills` aceita um `SKILL.md` avulso, além do ZIP.

A tela vira milestone irmão no `theo-cloud`, nascendo sobre uma API que já sabe dizer
*"isto está errado, aqui"*.

**Alternativas descartadas:**

- *Um milestone só no theo-cloud* — a tela reimplementaria a validação no navegador, criando
  segunda fonte de verdade sobre o que é uma skill válida; diverge do servidor no primeiro
  campo novo.
- *Um milestone só aqui, incluindo a tela* — o código da tela nasce no `theo-cloud`, o
  `cycle-release` viraria o checkbox de lá, e este ficaria `[ ]` para sempre mesmo entregue.

## Q2/4 — dependências

**Confirmado:** apenas **M1** (modelo de skill + validação rígida), já `[x]` — o M30 é elegível
de imediato. M7 e M28 (ponte remota do Theokit) **não** são dependência: autoria e consumo em
runtime não se tocam.

*Incerteza declarada na hora:* se o desenho do M28 exigir campo novo no frontmatter para skills
remotas, o `:validate` nasceria validando contrato prestes a mudar. Li só o objetivo do M28, não
o milestone inteiro. O dono optou por seguir.

## Q3/4 — Definition of done

Cinco bullets, confirmados: igualdade de `code` entre `:validate` e `POST` **garantida por
caminho compartilhado**; zero efeito colateral medido por contagem; `SKILL.md` avulso servindo a
mesma instrução resolvida; erro com campo e linha; escopo + métrica no `:validate`.

Fora do marco, explicitamente: a tela (milestone irmão no `theo-cloud`).

## Q4/4 — riscos novos

1. **Bomba de descompressão** — `:validate` convida tráfego para o caminho de unzip e parece
   inofensivo por não gravar. Mitigação: teto do tamanho **descomprimido**, com teste que mede
   que a recusa acontece **sem** inchar a memória.
2. **Verde no dry-run ≠ publish bem-sucedido** (TOCTOU sobre nome/versão/cota). Mitigação:
   contrato declara o que não cobre; resposta separa o decidível sem estado do que só o publish
   decide.

Descartado: "duas rotas de ingestão divergirem" — fechado estruturalmente pelo bullet 1.

## Step 5 — SOTA delta

**Pulado, com razão declarada:** dry-run é padrão consagrado (`kubectl --dry-run`,
`terraform plan`). Clonar peer para reaprendê-lo é trabalho sem retorno.
