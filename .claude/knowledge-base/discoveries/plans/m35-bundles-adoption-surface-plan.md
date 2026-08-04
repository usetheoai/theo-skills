# Discovery Plan: a superfície de bundles e adoção — o que o contrato precisa oferecer para a tela ser possível e honesta

> **Version 1.1** — revisada por `/discover-edge-cases` (2026-08-04), absorvendo EC-1 e EC-2 de
> `.claude/knowledge-base/reviews/m35-bundles-adoption-surface-edge-cases-2026-08-04.md`: dois alvos
> foram escolhidos pelo nome e medidos com **zero** sinal — `DataExport.tsx` não menciona token, e
> `middleware.py` não faz agregação.
>
> O M20 entregou bundles e tokens delegados; o M21, telemetria de adoção. Ambos
> `[x]`, ambos com **zero telas**. Esta descoberta investiga o que o contrato de leitura precisa
> expor para que a tela do M35 exista **sem induzir leitura errada** — e começa por um erro já
> medido: a DoD do M35 manda a tela dizer que a métrica *"é por bundle, não por skill"*, e o código
> mede **por skill**. Cumprir a DoD literalmente faria a tela mentir.

**Slug:** `m35-bundles-adoption-surface`
**Owner:** usetheodev
**Created:** 2026-08-04
**Time budget:** 5h (quebra por projeto em D1)

## Context

Quatro fatos motivam esta descoberta, e o primeiro contradiz documentação nossa.

1. **A granularidade da telemetria está documentada errado — em dois lugares.**
   `packages/api/src/server/store/adoption-store.ts:7-13` define
   `InstallEvent { bundleId, tokenId, skillId, revisionId, version }` — cada instalação é registrada
   **por skill**. E `:15-19` define `AdoptionRow { skillId, version, installs }`. A assinatura
   `adoption(bundleId, since)` (`:23`) **escopa** ao bundle, mas **agrega por skill+versão**.

   Contra isso: a DoD do M35 no `ROADMAP.md` exige que a tela diga que a métrica *"é por bundle, não
   por skill"*, e o ADR D3 do blueprint `skills-catalog-ux` rejeitou exibir contagem de instalação
   no catálogo alegando *"granularidade errada — uma skill dentro de um bundle muito baixado
   apareceria popular sem ninguém tê-la usado"*. **As duas afirmações são falsas.**

   O que de fato **não** existe é agregação **entre** bundles: uma skill distribuída em três bundles
   produz três linhas independentes, e *"instalações totais da skill X"* não é computável hoje.
   Essa é a limitação real, e é diferente da que registramos.

2. **Duas capacidades entregues e invisíveis.** `GET /v1/bundles`,
   `GET /v1/bundles/:bundleId/adoption`, `POST /v1/bundles/:bundleId/tokens` e
   `DELETE /v1/bundles/:bundleId/tokens/:tokenId` existem
   (`packages/api/src/server/handlers/distribution.ts`, 226 linhas). Nenhuma tem tela. Uma capacidade
   entregue e invisível é indistinguível de uma não entregue — e o roadmap a marca `[x]`.

3. **O isolamento entre publishers é estrutural, e o comentário faz uma afirmação forte.**
   `adoption-store.ts:29-34` declara que o escopo na construção impede *"inclusive o vazamento por
   diferença de contagem agregada"*. É uma afirmação de segurança que merece ser confrontada com
   como um peer resolve o mesmo problema — e com um teste.

4. **A tela vai exibir segredo.** O M35 exige token delegado emitido pela tela, *"aparece uma vez,
   depois só o identificador"*. É a superfície mais perigosa do milestone e a que mais se beneficia
   de prior art.

Regras que qualquer padrão importado terá de respeitar: `rules/architecture.md` (o contrato de
leitura é fronteira; a tela nunca fala com o store), `rules/public-copy.md` § 5 (número exibido sem
lastro medido é proibido) e `rules/testing.md` § 4.1 (o caso negativo do isolamento assere erro
tipado, não só ausência de linha).

## Objective

**Decidir o que o contrato de leitura de bundles/adoção deve expor** — qual granularidade, com que
rótulo, com que garantia de isolamento e como o token é apresentado — para que a tela do M35 seja
construível **sem induzir leitura errada** do número.

- [ ] Todas as questões respondidas com citação a `.claude/knowledge-base/references/`
- [ ] Veredito explícito sobre a granularidade a expor, corrigindo a DoD do M35 se for o caso
- [ ] Tabela: métrica → o que ela de fato conta → como rotulá-la sem mentir
- [ ] Seção "o que NÃO adotar"
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (por projeto de referência)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mcp-gateway-registry/` | `registry/metrics/client.py` (419, medido), `registry/metrics/utils.py` (71), `tests/unit/metrics/`, `frontend/src/components/AuditStatistics.tsx` (636), `frontend/src/components/DataExport.tsx` (493) | Único peer com telemetria **e** superfície: coleta (metrics/), teste dela (tests/unit/metrics/) e as duas telas que a expõem. Apache-2.0 |
| `.claude/knowledge-base/references/mcp-context-forge/` | `mcpgateway/templates/metrics_partial.html` (284), `metrics_top_performers_partial.html` (89), `observability_metrics.html` (871) | A outra forma de expor métrica — server-rendered. E fecha uma **pendência declarada**: o blueprint `skills-catalog-ux` deixou `metrics_top_performers_partial.html` como *não verificado* (§ Limites), sem determinar se ranqueia uso ou desempenho |

### Out-of-Scope (explícito)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mcp-gateway-registry/` — `auth/`, `auth_server/`, `keycloak/`, `terraform/`, `charts/`, `infra/`, `egress_auth/` | Fora da pergunta. O isolamento que interessa aqui é o do **dado de telemetria**, não o de autenticação |
| `.claude/knowledge-base/references/mcp-gateway-registry/frontend/` — tudo exceto `AuditStatistics.tsx` e `DataExport.tsx` | O catálogo já foi investigado em `skills-catalog-ux`; re-abrir duplica |
| `.claude/knowledge-base/references/agentskills-spec/` | Inteiro. O formato canônico não define telemetria — já medido em `skills-catalog-ux` § Q5 (seis campos, nenhum de adoção) |
| `.claude/knowledge-base/references/semantic-router/` | Inteiro. É retrieval; não tem publisher, bundle nem telemetria de adoção |
| `cat-agent-skills` | **Não clonado.** Citá-lo é fabricação (`discover-plan-golden-rule` § 1.2) |

## ADRs

### D1 — Orçamento e condições de parada

**Decisão:** `mcp-gateway-registry`: 3.5h · `mcp-context-forge`: 1.5h.

**Rationale:** o gateway-registry tem os dois lados (coleta e tela) e concentra 5 das 7 questões. O
context-forge entra por duas: a forma server-rendered e a pendência do `top_performers`. O maior
orçamento relativo ao context-forge (comparado à descoberta anterior) existe porque **aquela
descoberta deixou uma pendência explícita nele**, e fechá-la é dívida registrada.

**Stop condition — por questão:** Fase A vazia após 3 variantes → BLOCKED com motivo; seguir.
**Stop condition — por projeto:** orçamento esgotado → BLOCKED nas restantes; avançar. Todos nesse
estado → `<promise>BLUEPRINT_BLOCKED</promise>`.

**Anti-pattern:** nunca fabricar resposta de Fase B para fechar questão cuja Fase A esgotou
(Unbreakable Rule 3).

### D2 — Profundidade: telas inteiras, coleta por hotspot

**Decisão:** `AuditStatistics.tsx` (636) e `DataExport.tsx` (493) entram por Fase A com leitura
integral do bloco de render (a "terceira classe" que o plano do M32 introduziu). `metrics/client.py`
(419) e `middleware.py` (365) entram por Fase A restrita aos pontos de **agregação e rotulagem**.
`utils.py` (71) e `metrics_top_performers_partial.html` (89): inteiros.

**Rationale:** a pergunta é sobre **o que se expõe e como se rotula**, não sobre como se instrumenta.
A coleta interessa só onde decide granularidade. Alternativa: ler `middleware.py` inteiro
(rejeitada — 365 linhas de instrumentação HTTP que não respondem nada sobre rótulo).

**Consequences:** conclusões sobre a coleta valem para os trechos lidos, e o blueprint dirá isso.

### D3 — A pergunta do rótulo vem antes da pergunta do número

**Decisão:** toda questão sobre métrica exige, junto, **como o peer a rotula na tela**. Uma resposta
que traga o número sem o rótulo é incompleta e volta para reiteração.

**Rationale:** o defeito que motivou esta descoberta não é de cálculo — é de **nome**. Nossa DoD
manda chamar de "por bundle" algo que é por skill. `rules/public-copy.md` § 5 proíbe número sem
lastro; a extensão natural é que um número **mal rotulado** é pior que número ausente, porque
carrega autoridade que não tem.

**Alternativas consideradas:** investigar só o cálculo (rejeitada — reproduziria o erro que estamos
corrigindo); investigar só o rótulo (rejeitada — sem saber o que é contado, o rótulo não pode ser
julgado).

**Consequences:** as tabelas do blueprint terão sempre três colunas: métrica → o que conta → como é
rotulada.

### D4 — Nenhuma linha de código do peer atravessa

**Decisão:** produto é decisão em prosa + citação `path:line`. Zero cópia.

**Rationale:** `rules/reference-provenance.md` § 3. Os dois peers são Apache-2.0 e ainda assim não
copiamos: Python/Mongo e HTML server-rendered contra TypeScript/Postgres/React tornaria a tradução
literal pior que o desenho próprio.

**Consequences:** tabelas de decisão, não trechos.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — mapa) | Fase B (deep — Read no hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Que **granularidade** o peer coleta e qual ele **expõe** — e são a mesma? | techniques | `mcp-gateway-registry/registry/metrics/client.py` (419), `.../utils.py` (71) | `grep -nE "def |label|dimension|aggregate|group" client.py utils.py`; `utils.py` inteiro (pequeno, D2) | Ler os pontos de agregação e de rotulagem de dimensão | Tabela: dimensão coletada → exposta? → rótulo usado (D3) |
| Q2 | Como o peer **rotula** a métrica na tela para não induzir leitura errada? | techniques | `.../frontend/src/components/AuditStatistics.tsx` (636) | `ast-grep run -p 'return ($$$)' --lang tsx` para achar o bloco de render; fallback `grep -nE "label|title|tooltip|caption|per |total"` | Ler o bloco de render por completo (terceira classe, D2) | Lista: número exibido → texto que o acompanha → o que ele impede o leitor de concluir errado |
| Q3 | **Fecha a pendência do blueprint anterior:** `metrics_top_performers_partial.html` ranqueia **uso** ou **desempenho**? | techniques | `mcp-context-forge/mcpgateway/templates/metrics_top_performers_partial.html` (89) | SKIP Fase A — arquivo pequeno. Ler inteiro | Ler o template completo | Resposta binária + citação. Se for desempenho, o `skills-catalog-ux` § Q3 tinha razão em não usá-lo como sinal de adoção |
| Q4 | Como o peer expõe **segredo** (token/credencial) na superfície — exibição única, mascaramento, ou não expõe? | deps | **v1.1 (EC-1):** `.../frontend/src/pages/TokenGeneration.tsx` (377, **19 hits**, medido) como primário; secundários `FederationPeerForm.tsx`, `IAMGroups.tsx`; `mcp-context-forge/.../metrics_partial.html` (284) para o lado server-rendered. `DataExport.tsx` saiu — medido zero | `grep -nE "token|reveal|copy|mask|once"` em `TokenGeneration.tsx` | Ler os hotspots de exibição/cópia | Tabela: o que é exibido → uma vez ou sempre → como é revogado. Se o peer **não** expõe segredo, isso é resposta |
| Q5 | Que **janela e retenção** o peer aplica à telemetria, e como responde "total" quando o dado é particionado? | deps | `.../registry/metrics/client.py`, `mcp-context-forge/.../observability_metrics.html` (871) | `grep -nE "retention|window|since|days|range|ttl"` nos dois | Ler os pontos de janela | Descrição do mecanismo + veredito: aplicável ao nosso `adoption(bundleId, since)`? |
| Q6 | Que **teste** prova que um publisher não enxerga telemetria de outro? | tests | `.../tests/unit/metrics/` (3 arquivos: `test_middleware_label_bounding.py`, `test_middleware_target_kind.py`, `test_middleware_user_info.py`) | `grep -nE "def test_" nos três`; ler os que casarem com isolamento/tenant/user | Ler cada teste que casar | Lista: teste → o que asserta → prova isolamento? **Ausência é resposta** — e diria que nossa garantia estrutural não tem par |
| Q7 | **Bottleneck:** como o peer evita que a agregação de telemetria degrade com volume — índice, materialização, pré-agregação, ou nada? | tools | **v1.1 (EC-2):** `.../registry/metrics/client.py` (419, **10 hits** de agregação, medido). `middleware.py` saiu do plano — é instrumentação HTTP, com zero sinal de agregação | `grep -nE "aggregate|group|sum|count|index|cache"` em `client.py` | Ler os hotspots de agregação | Descrição + veredito para o nosso `countSince`/`adoption`: aplicável a Postgres ou específico de banco de documentos? |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q6 | Covered |
| Dependencies | Q4, Q5 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Total: **7 questões** (budget 5–10 ✓; máx 3 por canto ✓; mín 1 por canto ✓).

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Antes de responder Qx | Todo caminho declarado na Fase A existe | BLOCKED "path not found"; seguir |
| Fase A por questão | ≥ 1 hotspot OU 3 variantes tentadas | BLOCKED "Fase A esgotada"; seguir |
| Depois de responder Qx | Seção tem ≥ 1 citação `path:line` | Reiterar (1 retry) |
| **Toda questão de métrica (D3)** | A resposta traz o **rótulo**, não só o número | Reiterar; resposta sem rótulo é incompleta por decisão |
| **Q3 especificamente** | A pendência é **fechada** com veredito binário — uso ou desempenho | Reiterar; deixá-la aberta uma segunda vez seria dívida acumulada |
| **Q6** (v1.1, EC-3) | A resposta **distingue** isolamento de *publisher* de atribuição de *usuário* — `test_middleware_user_info.py` pode ser sobre atribuir, não sobre impedir leitura cruzada | Reiterar; confundir os dois atribuiria ao peer uma garantia que ele não dá |
| **Q6** | Ausência de teste é afirmada como ausência, não como "não encontrei" | Reiterar com a afirmação explícita |
| Orçamento por projeto | D1 não esgotado | Esgotou → BLOCKED nas restantes |
| Antes de prometer completo | 4 cantos preenchidos **e** seção "o que NÃO adotar" não vazia **e** veredito sobre a granularidade a expor | Recusar a promessa |

## Acceptance Criteria

- [ ] As 7 questões respondidas OU marcadas BLOCKED com motivo
- [ ] Os quatro cantos preenchidos
- [ ] Toda citação resolve em `.claude/knowledge-base/references/`
- [ ] **Veredito sobre a granularidade a expor**, dizendo explicitamente se a DoD do M35 e o ADR D3 do `skills-catalog-ux` precisam ser corrigidos
- [ ] Tabela métrica → o que conta → rótulo (D3) preenchida
- [ ] A pendência do `metrics_top_performers_partial.html` **fechada**
- [ ] Seção "o que NÃO adotar" presente e não vazia
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint em `.claude/knowledge-base/discoveries/blueprints/m35-bundles-adoption-surface-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases completas (plan → edge-cases → execute → confidence)
- [ ] Verdict registrado no cabeçalho do blueprint
- [ ] Zero citações fabricadas — `cat-agent-skills` **não** pode aparecer
- [ ] Coverage Matrix 100%
- [ ] Os ADRs citam regra do projeto: `rules/public-copy.md` § 5 (D3 — número sem lastro),
      `rules/reference-provenance.md` (D4), `rules/architecture.md` (fronteira contrato↔tela),
      `rules/testing.md` § 4.1 (Q6 — caso negativo do isolamento)
- [ ] O blueprint declara o que **não** investigou: a instrumentação HTTP do `middleware.py` fora
      dos pontos de agregação, e a superfície de catálogo do peer (já coberta em `skills-catalog-ux`)
