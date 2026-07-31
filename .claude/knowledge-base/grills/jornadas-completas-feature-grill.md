---
slug: jornadas-completas
date: 2026-07-31
generated_by: roadmap-feature
questions_answered: 3
unresolved_dims: []
status: completed
---

# Roadmap feature grill: jornadas completas (M22–M27)

## Decisões do owner (AskUserQuestion, 2026-07-31)

### Q1 — Numeração

**Pergunta:** o código entregue referencia M22 e M23 em 19 pontos, mas o ROADMAP para em M21.

**Resposta:** *Registrar M22/M23 como entregues.* Eles descrevem trabalho já mergeado e
verificado em produção; as jornadas novas começam em M24. Nada é renumerado — a regra de
imutabilidade de identificador vale para os dois lados: o roadmap não renumera, e o código
já mergeado também não.

### Q2 — Cruzamento com o fora de escopo

**Pergunta:** o roadmap declara fora de escopo *"Execução/runtime de skills — é
responsabilidade do Theokit, não do registry"*. O campo `execution` e o `npx` tocam o tema?

**Resposta:** *falso positivo.* `out_of_scope_overlap_false_positive: "Execução/runtime de
skills"`.

**Razão registrada:** o registry **classifica** onde a skill executa e **entrega** o
artefato; quem executa continua sendo o Theokit (no caso `remote`) ou a máquina do cliente
(no caso `local`). Nenhum milestone abaixo faz o registry rodar código de terceiro. Se um
dia isso mudar, a linha do fora de escopo terá de ser removida com nota datada — não por
interpretação silenciosa de um milestone que não a menciona.

### Q3 — Escopo

**Pergunta:** quantas jornadas viram milestone?

**Resposta:** *quatro* — carga remota, servidor de descoberta, `npx` por modo de execução, e
fechar versionamento/distribuição.

## Dimensões derivadas do código, não perguntadas

A skill manda explorar o repositório antes de perguntar. Estas foram medidas, com o comando
ou arquivo que sustenta cada uma:

| Dimensão | Como foi obtida |
|---|---|
| Dependências de cada milestone | grafo real de código: a carga depende do que M23 persistiu; o servidor MCP depende da carga existir; o `npx` depende de `execution` no catálogo |
| DoD | lacunas medidas no `/review` de 2026-07-31 e nas sondas contra o serviço no ar |
| Riscos | modos de falha observados **nesta série**, não hipotéticos — cada um aconteceu pelo menos uma vez |

## Lacunas medidas que originam M24–M27

- **Carga remota não existe.** A busca devolve resumo; o corpo só sai dentro do zip da
  revisão. Para "descobrir sem baixar" falta a rota que entrega as instruções.
- **`packages/mcp` não tem servidor.** Sem `bin`, sem transporte, sem dependência de MCP —
  são descritores de ferramenta numa biblioteca. Nenhum agente consegue conectar hoje.
  (Achado F-wir-9 do `/review`.)
- **O `npx` ignora `execution`.** `theoskill install` instala qualquer skill, inclusive uma
  `remote` que não deveria ir para disco.
- **M19 e M20 estão `[x]` sem chegar à produção.** A coluna `version` nunca é escrita, então
  `isNotNull(version)` descarta tudo; e não há caminho de escrita de bundle — um publisher
  não consegue criar um por meio suportado. (Achados F-wir-5 e F-wir-7 do `/review`.)
