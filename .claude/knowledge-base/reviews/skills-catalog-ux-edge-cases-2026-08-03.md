# Discover Edge Case Review — skills-catalog-ux

Date: 2026-08-03
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/skills-catalog-ux-plan.md` (v1.0)
Research questions analyzed: 8
Edge cases found: 7 (MUST FIX: 4, SHOULD TEST: 2, DOCUMENT: 1)

> **Método desta revisão.** Não especulei sobre o que os peers contêm — abri a zona e medi.
> Quatro dos sete achados abaixo vêm de contagem (`wc -l`, `grep -c`, `ls`), não de suposição.
> Os alvos que o plano v1.0 declarou estão **parcialmente errados**, e isso só apareceu porque a
> revisão foi feita contra o clone e não contra a memória de quem escreveu o plano.

## MUST FIX

### EC-1: o peer tem um card de skill literal, e o plano não o cita

- **Affected question:** Q1, Q2
- **Family:** Reference path
- **Scenario:** o plano manda estudar a anatomia do card em `components/cards/*` — os primitivos
  genéricos (`CardShell`, `CardStatsRow`, `TagList`). Mas o peer tem
  `frontend/src/components/SkillCard.tsx` com **887 linhas** (medido) e
  `frontend/src/types/skill.ts` com **105** — isto é, um card de **skill** concreto e o modelo de
  dados que o alimenta. O `/discover-execute` seguiria o plano, leria os primitivos e produziria um
  blueprint sobre caixas vazias.
- **Impact:** a resposta mais relevante da descoberta — *que campos de uma skill merecem virar
  slot de card* — ficaria de fora, e o blueprint pareceria completo.
- **Suggested fix:** acrescentar `frontend/src/components/SkillCard.tsx` e
  `frontend/src/types/skill.ts` à Q2 (e `components/SkillResources.tsx` como secundário), lendo
  `types/skill.ts` inteiro e `SkillCard.tsx` por Fase A.

### EC-2: Q3 aponta para a barra de filtros errada — a de auditoria, que não conta nada

- **Affected question:** Q3
- **Family:** Reference path / Interpretation
- **Scenario:** o plano usa `components/AuditFilterBar.tsx` (428 linhas) para responder de onde vem
  a contagem por faceta. Medido: `grep -c "count" AuditFilterBar.tsx` → **0**. É a barra de filtros
  do **audit log**, não do catálogo. Enquanto isso, `pages/Dashboard.tsx` — o pai que o comentário
  do `DiscoverTab.tsx:24-25` identifica como quem aplica o filtro de tag ("Records are already
  tag-filtered by the parent") — tem **41** ocorrências de `tagCount|counts|tagFilter|selectedTag`
  em 3157 linhas.
- **Impact:** a Q3 responderia sobre um componente que não participa do catálogo. Pior: responderia
  "o peer não conta facetas", que é falso, e o blueprint recomendaria contagem no cliente sem ver
  como o peer resolve.
- **Suggested fix:** trocar o alvo da Q3 para `frontend/src/pages/Dashboard.tsx` (Fase A obrigatória
  — 3157 linhas), mantendo `AuditFilterBar.tsx` apenas como contraste opcional.

### EC-3: o teste que de fato exercita filtro por tag não está no plano

- **Affected question:** Q7, Q8
- **Family:** Reference path
- **Scenario:** o plano manda procurar prova de "filtrar não perde item" em
  `components/cards/__tests__/` e `components/entities/__tests__/`. Medido, esses diretórios contêm
  `CardFooter.test.tsx`, `StatusDot.test.tsx`, `TagList.test.tsx`, `ToggleSwitch.test.tsx`,
  `EmptyState.test.tsx`, `EntityGrid.test.tsx` — testes de **componentes de apresentação**. O teste
  da jornada de descoberta é `components/__tests__/DiscoverTab.test.tsx`, com **468 linhas**, e não
  está citado.
- **Impact:** Q7 concluiria "o peer não testa a integridade do filtro" olhando para os arquivos
  errados. Um falso negativo com aparência de evidência — exatamente o defeito que o LT-035 deste
  projeto já pagou uma vez (teste sobre agregado que passa com metade do sistema morto).
- **Suggested fix:** acrescentar `frontend/src/components/__tests__/DiscoverTab.test.tsx` e
  `frontend/src/pages/__tests__/Dashboard.test.tsx` como alvos primários de Q7 e Q8.

### EC-4: D2 classifica por tamanho, e o arquivo central não cabe em nenhuma das duas classes

- **Affected question:** Q2 (e a regra D2 do plano)
- **Family:** Method / Scope
- **Scenario:** D2 diz "arquivos pequenos (≤ ~72 linhas) lidos inteiros; grandes por Fase A". Com a
  correção do EC-1, `SkillCard.tsx` (887) entra na classe "grande" e seria só mapeado — mas é o
  arquivo **mais central** da pergunta. Mapear por AST responde "quais funções existem", não "o que
  o autor escolheu exibir e por quê", que é a pergunta.
- **Impact:** o orçamento de 3h no `mcp-gateway-registry` agora cobre `Dashboard.tsx` (3157) +
  `SkillCard.tsx` (887) + `DiscoverTab.tsx` (732) + `DiscoverTab.test.tsx` (468) = 5.244 linhas.
  Sem regra explícita, o halt-loop ou estoura o orçamento ou lê tudo por cima.
- **Suggested fix:** emendar D2 com uma terceira classe: "arquivo central da questão, 100–1000
  linhas → Fase A para localizar o bloco de render, depois leitura **integral do bloco**, não do
  arquivo"; e subir o orçamento do `mcp-gateway-registry` de 3h para 4h (total 6h).

## SHOULD TEST

### EC-5: "top performers" pode ser desempenho, não adoção

- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** antes de usar
  `mcp-context-forge/mcpgateway/templates/metrics_top_performers_partial.html` como evidência de
  sinal de adoção, confirmar que a métrica ranqueada é de **uso** (chamadas, instalações) e não de
  **desempenho** (latência, taxa de erro). Se for desempenho, registrar a questão como respondida
  com *"o peer não exibe sinal de adoção no catálogo"* — que é resposta válida — em vez de forçar a
  analogia.

### EC-6: o veredito "adotar/não adotar" precisa do nosso lado da comparação

- **Affected question:** Q4, Q6
- **Suggested halt-loop checkpoint:** nenhuma linha da tabela de dependências/ferramentas pode ser
  fechada sem cruzar com `../theo-cloud/dashboard/package.json`. Sem o nosso lado, "não adotar
  porque já temos" é afirmação sem verificação — e o rung 4 da `parsimony-ladder` exige justamente
  saber o que **já está instalado**.

## DOCUMENT

### EC-7: o modelo de entidades do peer é maior que o nosso

- **Accepted risk:** o `mcp-gateway-registry` cataloga servidores, agentes, virtual servers,
  entidades customizadas **e** skills (visto nos imports de `DiscoverTab.tsx:6-12`). Nós catalogamos
  só skills. Existe risco real de o blueprint importar uma faceta que só faz sentido lá — o
  equivalente ao "filtro por plataforma" das referências visuais, que pressupõe múltiplas
  plataformas de destino, coisa que o nosso registro não tem. Aceito sem mudança de plano porque a
  regra D4 já filtra: toda faceta recomendada precisa responder *"nós medimos isso?"*. O que o
  blueprint precisa fazer é **dizer** quando descartou uma faceta por essa razão, em vez de omitir.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 | 0 | 0 |
| Q2 | 2 | 2 | 0 | 0 |
| Q3 | 2 | 1 | 1 | 0 |
| Q4 | 1 | 0 | 1 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 0 | 1 | 0 |
| Q7 | 1 | 1 | 0 | 0 |
| Q8 | 1 | 1 | 0 | 0 |
| (transversal) | 1 | 0 | 0 | 1 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT

Quatro correções de caminho e uma de método. Nenhuma delas expande o escopo: as questões continuam
as mesmas oito, os cantos continuam cobertos, e o único aumento é 1h de orçamento para o peer que
concentra a evidência. O plano v1.1 deve absorver EC-1 a EC-4 antes de `/discover-execute`.
