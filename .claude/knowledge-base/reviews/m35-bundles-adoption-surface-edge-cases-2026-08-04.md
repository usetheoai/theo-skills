# Discover Edge Case Review — m35-bundles-adoption-surface

Date: 2026-08-04
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/m35-bundles-adoption-surface-plan.md` (v1.0)
Research questions analyzed: 7
Edge cases found: 3 (MUST FIX: 2, SHOULD TEST: 1)

> **Método.** Os alvos foram medidos contra o clone (`grep -c`, `wc -l`), não avaliados de memória.
> Os dois MUST FIX vêm de contagem, e são o **terceiro** caso consecutivo do mesmo erro: o plano
> aponta para um arquivo cujo nome sugere o assunto, e o arquivo não contém sinal algum dele.

## MUST FIX

### EC-1: Q4 aponta para um arquivo que não expõe segredo nenhum

- **Affected question:** Q4
- **Family:** Reference path
- **Scenario:** o plano usa `frontend/src/components/DataExport.tsx` (493 linhas) para investigar
  como o peer exibe token/segredo. Medido: `grep -c "token|secret|reveal|mask"` → **0**. É um
  componente de exportação de dados; não toca credencial.

  O arquivo que responde é `frontend/src/pages/TokenGeneration.tsx` — **377 linhas, 19 ocorrências**
  do mesmo padrão. Existem também `FederationPeerForm.tsx`, `IAMGroups.tsx` e
  `RegistryCardSettings.tsx` com menções de token, como alvos secundários.
- **Impact:** o executor leria 493 linhas de exportação de CSV, não encontraria nada sobre exibição
  de credencial, e concluiria "o peer não expõe segredo na tela" — falso negativo com aparência de
  evidência, sobre a **superfície mais perigosa do M35**.
- **Suggested fix:** trocar o alvo primário de Q4 para `frontend/src/pages/TokenGeneration.tsx`,
  mantendo `metrics_partial.html` como o lado server-rendered.

### EC-2: Q7 aponta para instrumentação, não para agregação

- **Affected question:** Q7
- **Family:** Reference path
- **Scenario:** o plano usa `registry/metrics/middleware.py` (365 linhas) para investigar como o peer
  evita degradação na agregação. Medido: `grep -c "aggregate|pipeline|rollup|index"` → **0**. É
  middleware de instrumentação HTTP — conta requisições, não agrega telemetria.

  A agregação está em `registry/metrics/client.py`: **10 ocorrências** de `aggregate|group|sum|count`
  — o mesmo arquivo que a Q1 já usa.
- **Impact:** a Q7 é a pergunta de **bottleneck**, que o dono do projeto pediu explicitamente. Buscar
  no arquivo errado devolveria "o peer não faz nada especial", quando a resposta pode estar a um
  arquivo de distância.
- **Suggested fix:** Q7 passa a usar `client.py` como primário; `middleware.py` sai do escopo dela
  (permanece fora do plano inteiro, o que a seção § Limites do blueprint deve declarar).

## SHOULD TEST

### EC-3: Q6 pode confundir isolamento de *usuário* com isolamento de *publisher*

- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** o único teste que casa com o padrão é
  `tests/unit/metrics/test_middleware_user_info.py`. "User info" no middleware é sobre **atribuir**
  a métrica a um usuário — não necessariamente sobre **impedir** que um publisher leia a do outro.
  O checkpoint deve exigir que a resposta distinga as duas coisas, e afirme explicitamente se o peer
  **não** tem teste de isolamento entre publishers. Confundir atribuição com isolamento faria o
  blueprint atribuir ao peer uma garantia que ele não dá — e nos levaria a relaxar a nossa, que é
  estrutural e mais forte.

## Summary

| Question | Edges | MUST FIX | SHOULD TEST |
|---|---|---|---|
| Q4 | 1 | 1 | 0 |
| Q6 | 1 | 0 | 1 |
| Q7 | 1 | 1 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — duas correções de alvo, nenhuma expansão de escopo.

## Observação de método, que já vale como padrão

É a **terceira** descoberta seguida em que a revisão encontra alvo escolhido pelo nome do arquivo em
vez de pelo conteúdo (`AuditFilterBar` no `skills-catalog-ux`, `test_skill_models` no
`m32-skill-lifecycle`, e agora `DataExport` + `middleware`). O padrão é estável o bastante para virar
regra: **antes de declarar um alvo num plano de descoberta, medir a densidade do sinal nele**
(`grep -c` do termo que a questão investiga). Um alvo com zero ocorrências é alvo errado, por mais
que o nome prometa.
