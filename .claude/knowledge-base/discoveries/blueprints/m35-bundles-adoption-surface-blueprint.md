# Blueprint: a superfície de bundles e adoção — o que expor, e como rotular sem mentir

> **Version 1.0** — Investiga o que o contrato de leitura precisa oferecer para a tela do M35
> existir sem induzir leitura errada. **O achado que reorganiza o milestone é interno, não do peer:**
> a DoD do M35 e o ADR D3 do blueprint `skills-catalog-ux` afirmam que a telemetria é "por bundle",
> e o código mede **por skill**. Cumprir a DoD literalmente faria a tela mentir. Dos peers vêm três
> respostas úteis (exibição única de token, rótulo com denominador, ranking por desempenho) e uma
> ausência reveladora (nenhum teste de isolamento entre publishers).

**Slug:** `m35-bundles-adoption-surface`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m35-bundles-adoption-surface-plan.md` (v1.1)
**Owner:** usetheodev
**Generated:** 2026-08-04 via `/discover-execute` (em linha; sessão interativa)
**Confidence verdict:** _(a preencher por `/discover-confidence`)_
**Perguntas:** 7 — 6 `done`, 1 parcial (Q5)

## Context

M20 e M21 estão `[x]` e não têm tela. O M35 quer dar-lhes superfície. Antes de desenhar a tela,
esta descoberta pergunta o que o contrato precisa expor — e a primeira medição já contradiz duas
documentações nossas.

---

## Coverage Corner 1 — Integration Tests

### Q6 — que teste prova que um publisher não vê a telemetria de outro? **Nenhum. E o que existe é outra coisa.**

`.claude/knowledge-base/references/mcp-gateway-registry/tests/unit/metrics/test_middleware_user_info.py`
tem quatro casos, e **nenhum** testa isolamento:

| Linha | Caso | O que de fato prova |
|---|---|---|
| 27 | `test_reads_verified_context_username` | a métrica é **atribuída** ao usuário verificado |
| 32 | `test_ignores_forgeable_headers` | header forjado **não** vira atribuição |
| 38 | `test_anonymous_when_no_context` | sem contexto → anônimo |
| 43 | `test_anonymous_when_context_has_no_username` | contexto sem usuário → anônimo |

Isto é **atribuição**, não **isolamento**: provam que a métrica é rotulada com o dono certo, não que
um dono é impedido de ler a do outro. A distinção foi antecipada pelo EC-3 da revisão deste plano, e
confirma-se: confundi-las atribuiria ao peer uma garantia que ele não dá.

**O que vale importar mesmo assim — `test_ignores_forgeable_headers:32`.** É um caso negativo de
qualidade: o peer testa explicitamente que um cabeçalho controlado pelo cliente não contamina a
telemetria. Nosso `adoption-store` deriva o escopo da construção, então o vetor não existe do mesmo
jeito — mas a **classe** de teste (dado controlado pelo cliente não decide atribuição) é aplicável
ao `tokenId` do nosso `InstallEvent`.

**Consequência para nós:** nossa garantia de isolamento é **estrutural** (o store nasce escopado ao
workspace, `adoption-store.ts:29-34`) e **mais forte** que a do peer — que não a testa. Mas
"mais forte que um peer que não testa" é uma barra baixa: continua sem teste do nosso lado. É a
mesma lição do M32, onde a garantia estrutural existia e o teste que a provava não.

---

## Coverage Corner 2 — Dependencies

### Q4 — como o peer expõe segredo na tela? **Exibição única, com aviso explícito.**

`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/pages/TokenGeneration.tsx:366`:

> **"⚠️ Important: This token will not be shown again. Save it securely!"**

E `:92` implementa a cópia (`document.execCommand('copy')`), de modo que o usuário tem **uma**
chance de levar o valor consigo.

| Aspecto | O peer | Aplicável a nós? |
|---|---|---|
| Exibição única com aviso | sim, texto explícito na tela | **sim** — é literalmente o que o M35 exige ("aparece uma vez, depois só o identificador") |
| Cópia para clipboard | `document.execCommand('copy')` | conceito sim; a API está obsoleta — usar `navigator.clipboard` |
| Mascaramento posterior | **não observado** — não há re-exibição parcial | consistente com o nosso: depois da criação, só o `tokenId` |

**O que isso resolve do M35:** o critério *"nenhum segredo relegível"* tem prior art direta, e o
formato é o mais simples possível — um aviso em texto, não um mecanismo. A parsimônia aqui é do peer,
não nossa invenção.

### Q5 — janela e retenção da telemetria? **Parcial — não fechado.**

O `client.py` é um **emissor**: `emit_registry_metric` (`:78`), `emit_discovery_metric` (`:103`),
`emit_tool_execution_metric` (`:130`), `emit_health_metric` (`:159`), `emit_custom_metric` (`:170`).
Ele empurra métrica para fora; não define janela nem retenção — isso vive no backend de métricas, que
está fora do escopo deste plano.

**Registro como parcial em vez de inferir.** O nosso `adoption(bundleId, since)` recebe a janela como
parâmetro do chamador, e nada no peer contradiz ou confirma essa escolha. A pergunta "como responder
'instalações totais' quando o dado é particionado" **permanece aberta** e é decisão nossa, não
importável.

---

## Coverage Corner 3 — Tools

### Q7 — como o peer evita degradação na agregação? **Ele não agrega. Empurra.**

A arquitetura de métricas do peer é **push**, não **pull**: o `MetricsClient` (`client.py:27`) emite
eventos por tipo, e a agregação acontece no sistema de métricas a jusante. Não há pipeline de
agregação, materialização ou rollup no repositório.

**Consequência honesta: a Q7 não tem resposta importável.** O nosso `countSince` e `adoption` fazem
`GROUP BY` em Postgres, num modelo **pull**. São arquiteturas diferentes, e o peer não oferece prior
art para o nosso bottleneck.

**O que isso deixa aberto, e é o bottleneck real:** `adoption(bundleId, since)` agrega
`install_events` por skill+versão numa janela. Sem índice em `(workspace_id, bundle_id, created_at)`,
o custo cresce linearmente com o histórico. **Não medi** — o volume no banco de dev é trivial e um
`EXPLAIN` ali provaria forma, não custo. Fica registrado como item a medir com volume real, não como
recomendação sem lastro.

---

## Coverage Corner 4 — Techniques

### Q1 — que granularidade o peer coleta e expõe? **Por tipo de evento, e o emissor não decide agregação.**

`client.py` expõe cinco emissores nomeados por **tipo de evento**, não por entidade. A granularidade
de leitura não é decidida ali.

**O que isso ilumina do nosso lado — e é o achado central deste blueprint:**

`packages/api/src/server/store/adoption-store.ts`:

| Elemento | Linha | O que de fato contém |
|---|---|---|
| `InstallEvent` | 7-13 | `bundleId`, `tokenId`, **`skillId`**, `revisionId`, `version` |
| `AdoptionRow` | 15-19 | **`skillId`**, `version`, `installs` |
| `adoption(bundleId, since)` | 23 | **escopa** ao bundle, **agrega** por skill+versão |

**A medição é por (bundle, skill, versão).** Portanto:

- A DoD do M35 — *"a tela **diz** que é por bundle, não por skill"* — está **factualmente errada**.
  Cumpri-la faria a tela negar a granularidade que ela própria exibe.
- O ADR D3 do blueprint `skills-catalog-ux` — que rejeitou exibir instalações no catálogo alegando
  *"granularidade errada… uma skill dentro de um bundle muito baixado apareceria popular"* — está
  **errado pelo mesmo motivo**. O número é da skill, não do bundle.

**A limitação real é outra, e continua valendo:** não existe agregação **entre** bundles. Uma skill
distribuída em três bundles produz três linhas independentes, e *"instalações totais da skill X"* não
é computável hoje. Isso é o que impede o número no catálogo — não a granularidade.

### Q2 — como o peer rotula o número para não induzir erro? **Sempre com denominador.**

`.claude/knowledge-base/references/mcp-gateway-registry/frontend/src/components/AuditStatistics.tsx`
nunca mostra contagem sozinha:

- `:106` — tooltip `${seg.label}: ${seg.count.toLocaleString()} (${((seg.count/total)*100).toFixed(1)}%)`
- `:117` — a legenda repete o mesmo par: valor absoluto **e** percentual do total
- `:91-93` — as faixas são rotuladas por significado (`2xx`, `4xx`, `5xx`), não por código bruto

**O padrão: todo número aparece com o denominador ao lado.** "412" sozinho não diz se é muito ou
pouco; "412 (3,1%)" diz. É a defesa mais barata contra leitura errada, e não exige texto explicativo.

### Q3 — `metrics_top_performers_partial.html` ranqueia uso ou desempenho? **Desempenho. Pendência fechada.**

`.claude/knowledge-base/references/mcp-context-forge/mcpgateway/templates/metrics_top_performers_partial.html`:

- `:42-44` — `avgResponseTime`, formatado em milissegundos
- `:50-54` — `successRate`, com faixa de cor por limiar (≥95% verde, ≥80% amarelo, abaixo vermelho)

**É desempenho, não adoção.** Isso **fecha a pendência** que o blueprint `skills-catalog-ux` deixou
declarada em § Limites — e confirma que a cautela de lá estava certa: aquele blueprint recusou-se a
usar o arquivo como evidência de sinal de adoção sem verificar, e a verificação lhe dá razão.

---

## ADRs

### D1 — Corrigir a DoD do M35 antes de implementá-la

**Decisão:** o critério *"a tela diz que é por bundle, não por skill"* deve ser **reescrito** para
*"a tela diz que a contagem é da skill dentro daquele bundle, e que não soma entre bundles"*.

**Rationale:** o texto atual manda afirmar algo falso (Q1). Implementar a DoD literalmente entregaria
uma tela que nega a própria granularidade que exibe — pior que não ter tela, porque carrega
autoridade.

**Alternativas consideradas:**

1. **Implementar como está e registrar caveat.** Rejeitada: o caveat não impede a tela de mentir; só
   documenta que sabíamos.
2. **Agregar entre bundles para que "por skill" fique verdadeiro em sentido absoluto.** Rejeitada por
   escopo: exige decidir o que fazer com bundles de publishers diferentes que contêm a mesma skill —
   é modelagem nova, não ajuste de rótulo.

**Consequência:** o M35 precisa de emenda no `ROADMAP.md` antes do `/to-plan`. E o ADR D3 do
`skills-catalog-ux` precisa de correção — sua premissa está errada, ainda que a conclusão
("não exibir contagem no catálogo") continue certa por outro motivo.

### D2 — Todo número exibido leva denominador

**Decisão:** a tela do M35 nunca mostra contagem isolada; sempre valor absoluto **e** proporção do
total da janela.

**Rationale:** Q2 — o peer aplica isso consistentemente (`AuditStatistics.tsx:106,117`), e é a defesa
mais barata contra leitura errada. Alinha com `rules/public-copy.md` § 5: um número sem referência é
um número sem lastro para quem lê.

**Alternativas consideradas:**

1. **Só o absoluto.** Rejeitada: "412 instalações" não distingue sucesso de irrelevância.
2. **Só o percentual.** Rejeitada: esconde a escala — 100% de 2 instalações não é 100% de 2000.

**Consequência:** o contrato de leitura precisa devolver o **total da janela** junto das linhas, senão
a tela calcula denominador por conta própria e erra quando houver paginação.

### D3 — Token com exibição única e aviso em texto, sem mecanismo

**Decisão:** copiar o padrão do peer — o token aparece uma vez, com aviso explícito de que não será
mostrado de novo, e botão de cópia. Depois, só o identificador.

**Rationale:** `TokenGeneration.tsx:366,92`. É exatamente o que o M35 exige, e resolve com texto em
vez de mecanismo (`rules/parsimony-ladder.md` rung 5).

**Alternativas consideradas:**

1. **Mascaramento parcial posterior (`sk-...abc`).** Rejeitada: dá a impressão de que o valor é
   recuperável e convida à tentativa. O peer não faz.
2. **Re-exibição mediante re-autenticação.** Rejeitada por YAGNI: transformaria a tela num cofre, que
   é o que o M35 diz não querer.

**Consequência:** `document.execCommand('copy')` do peer está obsoleto — usamos `navigator.clipboard`,
com tratamento do caso em que o contexto não é seguro (o clipboard falha e a tela precisa dizer isso
em vez de fingir sucesso).

## Cross-cutting Comparison

### O que NÃO adotar

| Do peer | Por que não |
|---|---|
| Arquitetura **push** de métricas (`MetricsClient` emissor) | Nosso modelo é **pull** com `GROUP BY` em Postgres. Migrar para push resolveria um bottleneck que ainda não medimos, criando dependência de backend de métricas |
| `document.execCommand('copy')` | API obsoleta; `navigator.clipboard` é a substituta, e falha de forma detectável |
| Testes de `user_info` como prova de isolamento | Eles provam **atribuição**. Tratá-los como isolamento nos faria relaxar uma garantia estrutural que é mais forte |
| `metrics_top_performers` como sinal de adoção | Ranqueia **desempenho** (`avgResponseTime`, `successRate`) — Q3 |
| Rótulo "por bundle" da nossa própria DoD | Falso (D1). Não é do peer, é nosso, e é o achado principal |

## Recommendations

| # | Recomendação | Onde | Evidência |
|---|---|---|---|
| R1 | **Emendar a DoD do M35** antes do `/to-plan` — o rótulo correto é "da skill, dentro deste bundle; não soma entre bundles" | `ROADMAP.md` | D1; Q1 (`adoption-store.ts:7-19`) |
| R2 | **Corrigir o ADR D3 do `skills-catalog-ux`** — a premissa (granularidade de bundle) é falsa; a conclusão continua certa, mas por não haver agregação entre bundles | blueprint irmão | Q1 |
| R3 | **O contrato devolve o total da janela** junto das linhas, para a tela não calcular denominador sob paginação | `packages/api` | D2 |
| R4 | **Token: exibição única com aviso em texto**, `navigator.clipboard`, e falha de clipboard visível | `theo-cloud/dashboard` | D3; `TokenGeneration.tsx:366,92` |
| R5 | **Teste de isolamento entre publishers** — o peer não tem; nossa garantia é estrutural e não provada. Mesmo padrão do M32 | `packages/api/tests` | Q6 |
| R6 | **Teste da classe "dado do cliente não decide atribuição"** aplicado ao `tokenId` do `InstallEvent` | `packages/api/tests` | Q6 — `test_ignores_forgeable_headers:32` |
| R7 | **Medir o custo de `adoption`/`countSince` com volume real** antes de propor índice | `packages/api` | Q7 — não medido, e o peer não oferece prior art |

## Limites desta descoberta

- **Q5 ficou parcial.** O `client.py` é emissor e não define janela/retenção; o backend de métricas
  está fora do escopo. A pergunta "como responder 'total' com dado particionado" **permanece aberta**
  e é decisão nossa.
- **Q7 não tem resposta importável.** O peer é push, nós somos pull. O bottleneck do `GROUP BY`
  continua sem prior art e **sem medição** — o banco de dev tem volume trivial, e um `EXPLAIN` ali
  provaria forma, não custo. Registrado como item a medir, não como recomendação.
- **Não li `AuditLogTable.tsx` nem `observability_metrics.html` (871).** O orçamento foi absorvido
  pelas questões que tinham resposta; as duas telas restantes provavelmente confirmariam o padrão de
  Q2 sem acrescentar decisão.
- **`middleware.py` saiu do plano na revisão** (EC-2) e não foi lido — é instrumentação HTTP.
- **Nenhuma linha de código atravessou** (D4 do plano). Os peers são Apache-2.0 e ainda assim nada
  foi copiado.
