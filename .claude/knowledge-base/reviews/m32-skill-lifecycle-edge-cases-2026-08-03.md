# Discover Edge Case Review — m32-skill-lifecycle

Date: 2026-08-03
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/m32-skill-lifecycle-plan.md` (v1.0)
Research questions analyzed: 8
Edge cases found: 5 (MUST FIX: 3, SHOULD TEST: 1, DOCUMENT: 1)

> **Método.** Como na revisão anterior, os alvos do plano foram medidos contra o clone
> (`wc -l`, `grep -c`), não avaliados de memória. Três dos cinco achados vêm de contagem.

## MUST FIX

### EC-1: existe um arquivo de teste DEDICADO a lifecycle e o plano não o cita

- **Affected question:** Q1, Q3, Q6, Q7, Q8 (cinco das oito)
- **Family:** Reference path
- **Scenario:** o plano manda procurar prova de comportamento de estado em
  `tests/unit/test_skill_models.py`. Medido: **2** ocorrências de `is_enabled|status|deprecat` — sinal
  fraco. O arquivo que responde é `tests/unit/test_lifecycle_status.py`: **165 linhas, 73
  ocorrências**, com 16 casos nomeados que atacam exatamente as perguntas do M32:

  | Caso | Responde |
  |---|---|
  | `test_default_excludes_draft_and_deprecated_and_disabled:12` | Q3 — o default da busca exclui os três |
  | `test_include_all_returns_empty_dict:30` | Q3 — opt-in total |
  | `test_include_draft_only_excludes_deprecated:39` / `test_include_deprecated_only_excludes_draft:49` | Q3 — **opt-in granular por estado** |
  | `test_include_disabled_still_filters_status:58` | **Q1 — a ortogonalidade provada por teste**: incluir desabilitados não desliga o filtro de estágio |
  | `test_documents_without_status_field_pass_through:67` / `..._is_enabled_field_pass_through:75` | **Q6 — migração aditiva**: documento antigo sem o campo passa |
  | `test_invalid_status_rejected:106` | Q8 — caso negativo |
  | `test_agent_registration_defaults_to_draft:121` vs `test_agent_card_defaults_to_active:132` | Q1 — **default depende da origem** |

- **Impact:** o executor leria o arquivo errado, encontraria 2 menções, e concluiria "o peer quase
  não testa ciclo de vida" — um falso negativo com aparência de evidência. É a mesma classe de erro
  que a revisão do `skills-catalog-ux` pegou com o `AuditFilterBar`.
- **Suggested fix:** promover `tests/unit/test_lifecycle_status.py` a alvo **primário** de Q1, Q3,
  Q6, Q7 e Q8, lendo-o inteiro (165 linhas — cabe em D2 como "arquivo pequeno").

### EC-2: `skill_service.py` tem 1741 linhas e o D2 não o classificou

- **Affected question:** Q2, Q5
- **Family:** Method / Scope
- **Scenario:** o plano cita `registry/services/skill_service.py` sem medi-lo. Medido: **1741
  linhas**, com **33** ocorrências de `is_enabled|status`. O D2 declara duas classes (pequeno → ler
  inteiro; grande → Fase A) e nomeia arquivos específicos; este ficou sem regra.
- **Impact:** sem classificação, o executor ou lê 1741 linhas (estoura as 3.5h de D1) ou faz Fase A
  sem critério de parada nos 33 hotspots.
- **Suggested fix:** emendar D2 declarando `skill_service.py` na classe "arquivo grande" — Fase A
  obrigatória, e ler apenas os hotspots que **escrevem** estado (a Q2 é sobre transição, não sobre
  leitura), limitando a ~10 hotspots.

### EC-3: Q3 aponta para o repositório errado como alvo principal

- **Affected question:** Q3
- **Family:** Reference path
- **Scenario:** a Q3 lista `search_repository.py` e `skill_repository.py` lado a lado. Medido:
  `search_repository.py` → **94** ocorrências; `skill_repository.py` → **5**. O efeito do estado na
  descoberta está esmagadoramente no primeiro.
- **Impact:** tratar os dois como equivalentes dilui o esforço e arrisca concluir sobre resolução a
  partir de um arquivo que quase não fala do assunto.
- **Suggested fix:** declarar `search_repository.py` como primário (94 hits, Fase A obrigatória) e
  `skill_repository.py` como secundário, usado **só** para responder a metade "resolução por id" da
  Q3 — que é onde seus 5 hits importam.

## SHOULD TEST

### EC-4: a Q3 pode colapsar "busca" e "listagem" sem perceber

- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** a tabela da Q3 tem **três** colunas obrigatórias — aparece na
  listagem? aparece na busca? resolve por id? — e o checkpoint deve recusar a resposta se as três não
  estiverem preenchidas por citação independente. O teste `test_default_excludes_...` fala do filtro
  de **busca**; concluir dele que a listagem também exclui seria inferência, não medição.

## DOCUMENT

### EC-5: o peer é DocumentDB/Mongo; nós somos Postgres/Drizzle

- **Accepted risk:** `skill_repository.py` vive sob `repositories/documentdb/`, e os testes
  `..._field_pass_through` (linhas 67, 75) descrevem um comportamento **natural de banco de
  documentos**: documento antigo sem o campo simplesmente não tem o campo. Em Postgres com Drizzle,
  o equivalente é uma coluna com default — semântica parecida, mecanismo diferente. Aceito sem mudar
  o plano porque a Q6 já pergunta explicitamente se o mecanismo é aplicável ao nosso stack; o que o
  blueprint precisa fazer é **não** apresentar "o documento passa direto" como se fosse portável.

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 1 | 1 | 0 | 0 |
| Q2 | 1 | 1 | 0 | 0 |
| Q3 | 3 | 2 | 1 | 0 |
| Q5 | 1 | 1 | 0 | 0 |
| Q6 | 2 | 1 | 0 | 1 |
| Q7 | 1 | 1 | 0 | 0 |
| Q8 | 1 | 1 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT

Três correções de alvo, nenhuma expansão de escopo: as oito questões seguem as mesmas, os quatro
cantos seguem cobertos. O plano v1.1 deve absorver EC-1 a EC-3 antes de `/discover-execute`.
