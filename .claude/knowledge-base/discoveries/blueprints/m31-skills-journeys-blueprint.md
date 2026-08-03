# Blueprint: M31 — as jornadas de skills, no nível do contrato de design

- **Slug:** `m31-skills-journeys`
- **Plano de origem:** `knowledge-base/discoveries/plans/m31-skills-journeys-plan.md` (v1.1, SHIPPABLE 100/100)
- **Data:** 2026-08-03
- **Perguntas:** 6 — todas `done`, nenhuma `blocked`

## Context

A auditoria de 2026-08-03 mediu, navegando o `app-dev` por clique: a `<main>` de `/skills` sem um
único botão, a jornada terminando em *0 versões → use a CLI*, e 1 de 7 escritas da API com
superfície. O M31 nasceu daí. A pergunta que sobrava — e que nenhum código nosso responde — era
**como mostrar ao operador por que um resultado apareceu numa busca híbrida**, sem virar dump de
debug. O M4 já registra por que importa: a recall é carregada pelo FTS; a perna vetorial isolada
dá 0.308 com o embedder stub, e um score único esconde exatamente isso.

## Objective

Decidir o desenho da explicabilidade de busca, da autoria com validação prévia e da governança
destrutiva do registro — em padrões aplicáveis, não em screenshots — com evidência de peers reais
e um veredito explícito sobre o que **não** adotar.

## Sumário executivo

A pergunta que motivou a pesquisa era *como mostrar ao operador por que um resultado apareceu*.
A resposta encurta o M31 de forma inesperada: **nós já temos a arquitetura certa e o peer não.**

O `semantic-router` mistura as duas pernas **no nível do vetor**, antes de existir similaridade —
a atribuição por perna não é perdida no fim, ela nunca chega a ser computada. Nós fundimos no
nível de **rank** (RRF), com as duas listas independentes em mãos. A informação que a tela precisa
existe hoje no fluxo de controle do `rrfFuse` e é descartada na última linha.

Isso transforma o critério "descoberta observável" do M31 de *mudança arquitetural* em *carregar
dois números que já foram calculados*.

---

## Coverage Corner 1 — Integration Tests

### Q5 — existe teste que reprova se uma perna morrer? **Não.**

`knowledge-base/references/semantic-router/tests/unit/test_router.py:227` define
`routers = [SemanticRouter, HybridRouter]` e roda a **mesma suíte parametrizada** sobre os dois.
Isso asserta que o roteamento funciona — nunca que as duas pernas contribuíram. `TestHybridRouter`
(linha 580) exercita construção e chamada; a linha 701-702 traz até uma exclusão explícita
(`# we don't test postgres and hybrid together`).

O único teste específico da perna esparsa é
`knowledge-base/references/semantic-router/tests/functional/encoders/test_bm25_functional.py`,
com um caso — `test_bm25_scoring` — que exercita **o encoder isolado**, não a mistura.

> **Correção de método, registrada:** o plano v1.1 citava este arquivo em `tests/unit/`. O
> caminho real é `tests/functional/encoders/`. Descoberto ao verificar na mesma iteração, que é o
> checkpoint 1. Uma citação de memória teria entrado no blueprint como fabricação.

**O que isto significa para nós — e é o oposto de "copiar":** este é exatamente o defeito que o
`theo-skills` **já corrigiu**. O LT-035 registra que o portão de qualidade da busca "voltou a não
reprovar porque o agregado diluía", e que o teste passou a provar **os dois sentidos**: com o
motor semântico vivo passa, com ele morto **reprova**. O peer não tem esse discriminador. Não há
técnica de teste a importar aqui; há uma confirmação de que a nossa é mais rigorosa, e um lembrete
de que o M31 não pode regredir nela ao mexer no `rrfFuse`.

---

## Coverage Corner 2 — Dependencies

### Q4 — o Postgres FTS que já temos cobre a perna léxica? **Sim, e melhor para a nossa forma.**

`knowledge-base/references/semantic-router/pyproject.toml` declara no núcleo apenas
`numpy>=1.25.2` (linha 11); a perna esparsa vive em `[project.optional-dependencies]` (linha 26) —
o extra `[hybrid]`, com BM25 **em processo**.

| Dependência do peer | Papel | O FTS que temos cobre? |
|---|---|---|
| BM25 (extra `[hybrid]`) | perna léxica, índice em memória do processo | **Sim** — `to_tsvector`/`ts_rank` no Postgres |
| `numpy` | álgebra dos vetores densos | **Sim** — pgvector faz no banco |

**Veredito: adotar nenhuma.** E a razão não é só "já temos": um índice BM25 em processo precisa
ser **reconstruído e mantido em sincronia** a cada publicação de skill, e passa a ser estado do
processo — exatamente o acoplamento que o `rules/architecture.md` manda evitar. O FTS do Postgres
já vive junto do dado, transacionalmente. Trazer BM25 seria adicionar um segundo índice para
resolver o que o primeiro resolve.

---

## Coverage Corner 3 — Tools

### Q6 — alguma ferramenta dos peers resolve o que fazemos à mão? **Não.**

`knowledge-base/references/mcp-gateway-registry/pyproject.toml` (linhas 80-88) usa a família
pytest: `pytest`, `pytest-asyncio`, `pytest-cov`, `pytest-mock`, `pytest-xdist`, `pytest-html`,
`pytest-json-report`.

| Ferramenta | Papel | Adotar? |
|---|---|---|
| `pytest-xdist` | paralelismo de testes | **Não** — o Vitest paraleliza por padrão |
| `pytest-cov` | cobertura | **Não** — temos `vitest --coverage` |
| `pytest-html` / `-json-report` | relatório | **Não** — o CI já consome o reporter do Vitest |

Ecossistema diferente, nenhuma lacuna nossa. **Corner respondido com "nada a importar"** — que é
uma resposta, não um vazio: procurar e não achar é informação, desde que se diga onde se procurou.

---

## Coverage Corner 4 — Techniques

### Q1 — o híbrido preserva a contribuição de cada perna? **O peer destrói; nós preservamos.**

**No peer.** `knowledge-base/references/semantic-router/semantic_router/routers/hybrid.py:523-544`
define `_convex_scaling`, e o que ele escala são os **vetores**, não os scores:

- `scaled_dense = np.array(dense) * self.alpha` (linha 536)
- `scaled_sparse = {k: v * (1 - self.alpha) ...}` (linha 541)

Só depois o índice calcula **uma** similaridade sobre os vetores já misturados (linhas 303, 345,
387). O tipo devolvido confirma:
`knowledge-base/references/semantic-router/semantic_router/schema.py:45` define
`class RouteChoice` com `similarity_score: Optional[float]` (linha 50) — **um número**.

A consequência é arquitetural, não cosmética: **a contribuição por perna não é colapsada no fim,
ela nunca é calculada.** Recuperá-la exigiria rodar duas buscas — isto é, abandonar o desenho.

**Em nós.** `packages/core/src/domain/retrievers/hybrid-retriever.ts` funde por **Reciprocal Rank
Fusion** sobre duas listas ranqueadas independentes. No `rrfFuse` (linhas 55-98):

- `accumulate(vectorResults)` e depois `accumulate(keywordResults)` — duas passadas separadas
- cada passada calcula `term = 1 / (RRF_K + rank)` (linha 64)
- na segunda, `existing.score += term` (linha 67) — o código **sabe** que a skill está nas duas

A atribuição existe no fluxo de controle. A linha 97 (`.map(({skill, score}) => ({...skill, score}))`)
emite só a soma.

**Trade-off honesto do nosso lado:** RRF ignora a magnitude do score original — só a posição. Ele
diz "esta skill apareceu em 3º na lexical e em 1º na vetorial", não "casou 0.91 na vetorial". Para
a pergunta do operador (*qual perna trouxe isto?*) o rank basta e é mais estável; para
"quão parecido?" ele não responde. Registrado para não vendermos o que não temos.

### Q2 — o registro-peer expõe por que casou? **Expõe score, não a perna — e reescala.**

`knowledge-base/references/mcp-gateway-registry/registry/services/semantic_search_service.py:46`
documenta o retorno com `path` e `relevance_score`. O
`.../registry/services/ard_search_service.py` faz duas coisas que valem:

- **linha 127:** `score = max(0, min(100, round((relevance or 0.0) * 100)))` — reescala o score
  opaco para **0-100**, uma escala que um humano lê sem manual.
- **linha 227:** *"Ordering is deterministic (score desc, then identifier asc)"* — desempate
  estável por identificador.

`.../registry/embeddings/client.py` é encoder puro (`encode`, `get_embedding_dimension`) — o score
nasce na camada de serviço, não no cliente de embedding. Separação que já temos.

**Aplicável a nós:** sim, as duas. Nosso score RRF bruto vive na casa de `1/(60+rank)` ≈ 0,016–0,033
— ilegível. E o `rrfFuse` **já** desempata por `skill_id` (linha 95), a mesma escolha, pelo mesmo
motivo: resultado determinístico independente de qual retriever responde primeiro.

### Q3 — o que é validável antes de publicar? **A spec dá a lista; o diagnóstico é nosso.**

`knowledge-base/references/agentskills-spec/docs/specification.mdx` define restrições
estaticamente verificáveis, sem publicar nada:

| Campo | Restrição (linhas 27, 60-65, 93-94) |
|---|---|
| `name` | obrigatório; 1–64 chars; minúsculas, números e hífen; sem hífen inicial/final; **sem hífen duplo**; **igual ao nome do diretório pai** |
| `description` | obrigatório; 1–1024 chars |
| `license` | campo previsto (linha 110) |

**O que a spec NÃO define:** o formato do erro. Não há menção a linha, campo ou posição — ela
especifica o **formato**, não o diagnóstico de quem o valida.

**Consequência para o M31:** o `POST /v1/skills:validate` do M30, que já responde `field` e `line`,
**está à frente da spec**, não atrás. A jornada de autoria não precisa esperar padrão externo;
precisa de uma tela que consuma o que a API já devolve. O que a spec acrescenta é a lista de
regras que a tela pode checar **no cliente**, antes mesmo do round-trip — `name` sem hífen duplo é
verificável enquanto a pessoa digita.

---

## ADRs

### D1 — Carregar a atribuição por perna no RRF, em vez de recomputar ou re-arquitetar

**Decisão:** estender o acumulador do `rrfFuse` de `{skill, score}` para carregar também o termo de
cada lista, e emitir os dois no resultado.

**Alternativas consideradas:**

1. **Rodar as duas buscas de novo, só para a tela.** Rejeitada: dobra a carga do caminho mais
   quente por informação que já foi calculada e jogada fora. Também introduz divergência — duas
   execuções podem ranquear diferente se o acervo mudar entre elas.
2. **Adotar a mistura no nível do vetor, como o peer.** Rejeitada com evidência: `_convex_scaling`
   torna a atribuição **impossível** de recuperar downstream, e ainda exige calibrar `alpha` — que
   o nosso comentário em `hybrid-retriever.ts:3` registra ter sido evitado de propósito ("RRF
   constant k=60; calibration-free — no weights").
3. **Expor só o score fundido, como o `mcp-gateway-registry`.** Rejeitada porque é exatamente o
   que temos hoje, e o M4 já mostrou o que ela esconde: recall carregada pelo FTS, perna vetorial
   isolada em 0.308. Um número só não distingue "achou porque as palavras batem" de "achou porque
   entendeu".

**Consequência:** mudança aditiva no contrato de leitura. Nenhum consumidor atual quebra.

### D2 — Reescalar o score para exibição, mantendo o bruto no contrato

**Decisão:** a API devolve o valor bruto do RRF **e** a atribuição; a reescala para 0-100 acontece
na tela.

**Alternativas consideradas:**

1. **Reescalar no servidor** (o que o `ard_search_service.py:127` faz). Rejeitada: perde precisão
   para outros consumidores (CLI, MCP, agente), que não são humanos e não precisam da escala
   humana. O peer pode fazê-lo porque a única saída dele é a tela.
2. **Não reescalar em lugar nenhum.** Rejeitada: `0,0163` não é legível, e a diferença entre
   `0,0163` e `0,0161` não comunica nada a quem decide.

**Consequência:** a regra de reescala vira lógica pura, testável fora do React — o que o
`CLAUDE.md` deste repo já exige das telas.

---

## Cross-cutting Comparison

### O que NÃO se aplica a nós

Um blueprint que só diz "eles fazem X, façamos X" comparou nada. As três coisas deliberadamente
não adotadas:

| Do peer | Por que não |
|---|---|
| Mistura no nível do vetor (`_convex_scaling`) | destrói a atribuição que o M31 precisa **e** exige calibrar `alpha`; nosso RRF é calibration-free |
| BM25 em processo | um segundo índice a manter em sincronia, para resolver o que o Postgres FTS já faz junto ao dado |
| Suíte parametrizada sobre `[SemanticRouter, HybridRouter]` como cobertura do híbrido | não discrimina perna morta — é o defeito que o nosso LT-035 já corrigiu |

## Recommendations

Em ordem de dependência — a de cima destrava as de baixo.

| # | Recomendação | Onde | Evidência que a sustenta |
|---|---|---|---|
| R1 | **Carregar o termo de cada perna no `rrfFuse`** e emiti-lo por resultado. A estrutura já separa as duas passadas; falta não descartar. | `packages/core/.../hybrid-retriever.ts` | D1; `rrfFuse` linhas 62-67 vs 97 |
| R2 | **`GET /v1/skills:retrieve` devolve a atribuição** — por resultado, quais pernas casaram e o rank em cada uma. Aditivo. | `packages/api` | D1; contraste com `RouteChoice.similarity_score` (peer) |
| R3 | **`GET /v1/skills` devolve `visibility` e presença de embedding.** Sem o segundo não existe métrica "descobríveis", e publicada ≠ achável. | `packages/api` | DoD do M31; auditoria § contrato de leitura |
| R4 | **Playground de descoberta** mostrando score reescalado 0-100 **e a perna**, com desempate determinístico. | `theo-cloud/dashboard` | D2; `ard_search_service.py:127,227` |
| R5 | **Validação no cliente antes do round-trip** para as regras estáticas da spec (`name` 1-64, sem hífen duplo, minúsculas), e o `field`/`line` do `:validate` para o resto. | `theo-cloud/dashboard` | Q3; `specification.mdx` linhas 60-65 |
| R6 | **Teste que discrimina a perna** no `rrfFuse`: com uma lista vazia, a atribuição do resultado não pode alegar aquela perna. | `packages/core` | Q5 — o peer não tem; o LT-035 provou aqui que agregado dilui |

**R6 não é opcional.** É a mesma classe de defeito que o LT-035 corrigiu: um teste sobre o
agregado passa com metade do sistema morto. Se a atribuição entrar sem um teste que a falseie, o
M31 entrega um campo que pode mentir — e mentir com aparência de dado.

## Limites desta descoberta

- **Não li o `mcp-context-forge`.** A pergunta que o citava (declaração de impacto para ação que
  afeta consumidores) foi **removida** no plano v1.1 via ADR D5 — o impacto de promover canal é
  derivável do nosso domínio e nenhum peer tem nosso modelo de canal. O clone permanece na zona
  para descobertas futuras.
- **Não medi desempenho.** A afirmação "carregar dois números é barato" é estrutural (os valores já
  existem no escopo), não medida. Se o M31 mostrar regressão de latência no retrieve, é aqui que a
  suposição deve ser confrontada.
- **`semantic-router` é Python, nós somos TypeScript.** Nenhuma linha foi copiada — nem poderia,
  por `rules/reference-provenance.md`. O que atravessou foi decisão de design, não código.
