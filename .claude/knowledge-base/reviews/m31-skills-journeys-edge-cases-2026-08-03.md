# Discover Edge Case Review — m31-skills-journeys

Date: 2026-08-03
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/m31-skills-journeys-plan.md` (v1.0)
Research questions analyzed: 8
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

> **Método:** cada premissa foi testada **contra o disco**, não conferida no papel. Um checklist
> respondido de memória encontra zero edge cases — que é exatamente o que este passo existe para
> não produzir.

## MUST FIX

### EC-1: o método da Q7 não encontra nada — produziria um `blocked` FALSO

- **Affected question:** Q7 (Integration tests)
- **Family:** Method
- **Scenario:** o plano manda
  `find knowledge-base/references/semantic-router -path '*test*' -name '*hybrid*'`.
  Executado: **zero resultados**. Não existe arquivo de teste com `hybrid` no nome.
- **Impact:** o halt-loop marcaria Q7 como `blocked` por "não há teste de híbrido" — e a
  conclusão seria **falsa**. O `grep` mostra que `hybrid` aparece em três testes reais
  (`tests/unit/test_router.py`, `tests/unit/test_sync.py`,
  `tests/integration/test_router_integration.py`), e existe `tests/unit/test_bm25_functional.py`
  — BM25 **é** a perna esparsa, o análogo direto do nosso FTS. O corner de integration tests
  ficaria vazio por erro de método, não por ausência de evidência.
- **Suggested fix:** trocar o método por
  `grep -rl 'hybrid' knowledge-base/references/semantic-router/tests/` + ler
  `tests/unit/test_bm25_functional.py`.

### EC-2: o método da Q3 casa com ruído e não olha onde a pergunta vive

- **Affected question:** Q3 (Techniques)
- **Family:** Method
- **Scenario:** o plano manda `Grep -r 'score|similarity|rank'` em `registry/`. Executado, os
  arquivos que casam são `scripts/inspect-documentdb.py`, `utils/url_normalize.py`,
  `utils/pingfederate_manager.py`, `utils/iam_manager.py` — IAM, normalização de URL e scripts.
  **Nenhum** deles é busca.
- **Impact:** duas leituras erradas possíveis, ambas ruins. O investigador conclui "eles não
  expõem score" a partir de ruído; ou gasta o orçamento lendo gestão de IAM. Pior: a pergunta é
  *o que o **operador** vê*, e o método nem olha `registry/static/`, que é a interface.
- **Suggested fix:** restringir a `registry/embeddings/client.py`, `registry/services/` e
  `registry/static/` — e declarar que a ausência de score na UI **é** uma resposta válida, não
  uma falha de busca.

## SHOULD TEST

### EC-3: Q1 depende do tipo que a Q2 descobre

- **Affected question:** Q1 (depende de Q2)
- **Suggested halt-loop checkpoint:** responder **Q2 antes de Q1**. Q1 pergunta se a contribuição
  de cada perna sobrevive ao resultado; isso só se responde conhecendo o tipo devolvido, que é
  exatamente a Q2. Na ordem inversa, `hybrid.py` é lido duas vezes — desperdício dentro de um
  orçamento de 3h.

### EC-4: Q6 atravessa linguagem e pode produzir uma tabela inútil

- **Affected question:** Q6 (Dependencies)
- **Suggested halt-loop checkpoint:** a resposta só conta como `done` se disser, para cada
  dependência, **se o Postgres FTS que já temos cobre aquilo** — em vez de listar pacotes Python
  que não vamos usar. O `semantic-router` é Python com BM25; nós somos TypeScript com FTS nativo
  do Postgres. Sem esse recorte, o corner de dependências fica preenchido e sem valor, que é a
  forma mais cara de cobertura falsa.

## DOCUMENT

### EC-5: clone parcial (`--filter=blob:none`) e `grep -r` em peer grande

- **Accepted risk:** o filtro hidrata blobs sob demanda. Verificado que a leitura funciona
  (`hybrid.py` = 29.112 bytes acessíveis), então **não há risco de conteúdo ausente**. O que
  resta é latência: um `grep -r` no `mcp-context-forge` inteiro pode hidratar muitos blobs. O
  ADR D2 do plano já manda ler **por símbolo, não por varredura**, o que evita o caso. Aceito
  sem mudança.

### EC-6: o `admin_ui` do `mcp-context-forge` é JavaScript vanilla, não um framework

- **Accepted risk:** são 50 arquivos `.js` sem framework. Não há arquitetura de componentes a
  emprestar, e nem se deveria — o ADR D4 já proíbe peer como fonte de layout. O que se extrai da
  Q5 é **texto de impacto** (o que eles dizem que deixa de valer), que independe da stack.
  Registrado para que ninguém abra o diretório esperando padrão de componente e conclua que o
  peer "não serve".

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 1 | 0 | 1 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 1 | 1 | 0 | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 1 | 0 | 0 | 1 |
| Q6 | 1 | 0 | 1 | 0 |
| Q7 | 1 | 1 | 0 | 0 |
| Q8 | 0 | 0 | 0 | 0 |
| (global) | 1 | 0 | 0 | 1 |

**Verdict: DISCOVERY PLAN NEEDS ADJUSTMENT** — 2 MUST FIX, ambos de **método**, nenhum de
escopo. As perguntas estão certas; dois caminhos de busca estavam errados, e os dois teriam
produzido conclusão falsa em vez de erro visível. É o modo de falha mais caro: o corner fica
marcado como coberto.

## O que este review NÃO encontrou, e por quê

Nenhum edge case de **citação fabricada**: os 14 caminhos do plano foram validados por script
antes deste passo (0 inexistentes). Nenhum de **cobertura**: os quatro corners têm pergunta com
método. Nenhum de **escopo**: o out-of-scope do plano é explícito por diretório, não "o resto".

Não inventei risco para preencher relatório. Seis achados, todos reproduzíveis por comando.
