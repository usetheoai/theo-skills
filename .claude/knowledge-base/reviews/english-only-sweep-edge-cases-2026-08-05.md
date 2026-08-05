# Edge Case Review — english-only-sweep

Date: 2026-08-05
Plan: `.claude/knowledge-base/plans/english-only-sweep-plan.md` (v1.0)
Tasks analyzed: 16 (T0.1, T1.1–T1.3, T2.1–T2.2, T3.1–T3.3, T4.1–T4.2, T5.1–T5.5 as one block, T6.1–T6.3)
Cases found: 18 (EDGE: 6, NEGATIVE: 12 | MUST FIX: 9, SHOULD TEST: 6, DOCUMENT: 3)

The concentration is deliberate and not evenly spread: **four of the nine MUST FIX land on T0.1**, the language gate. That is the task the Goal's metric depends on, and a gate that reports zero while the debt is still there is worse than no gate — it converts an open problem into a closed one on paper. The other five are split between the version-uniqueness pair (T4.1/T4.2), the API-surface guarantee (T1.3), the CI window (T6.2), and one internal contradiction inside the plan itself (T5.x).

---

## MUST FIX

### EC-1: A catraca compara contra `HEAD`, que num PR é o merge commit — ela nunca dispara onde importa

- **Affected task:** T0.1
- **Kind:** NEGATIVE (o mecanismo de proteção falha em silêncio)
- **Family:** State / Timing
- **Scenario:** `actions/checkout@v4` sem `ref:` faz checkout do **merge commit** (`refs/pull/N/merge`) em eventos `pull_request` — verificado em `.github/workflows/ci.yml:113`. O plano manda ler o orçamento anterior com `git show HEAD:tests/repo/language-budget.json`. Nesse checkout, `HEAD` **já contém as mudanças do PR**, então o "orçamento anterior" é o orçamento do próprio PR. Um PR que sobe `tierB` de 131 para 140 e declara 140 passa nas duas asserções: `current <= previous` (140 ≤ 140) e `budget == current` (140 == 140).
- **Impact:** a catraca — a única coisa que impede a dívida de crescer — é decorativa exatamente no gate de PR, que é onde ela deveria morder. O portão vira um verificador de honestidade do orçamento, não um limite.
- **Suggested fix:** comparar contra a base, não contra `HEAD` — `git show $(git merge-base origin/develop HEAD):tests/repo/language-budget.json` (ver EC-2 para a pré-condição).

### EC-2: `fetch-depth: 1` torna `merge-base` incomputável — a correção da EC-1 quebra o portão

- **Affected task:** T0.1
- **Kind:** NEGATIVE
- **Family:** Resource
- **Scenario:** o checkout do `ci.yml:113` usa o default `fetch-depth: 1` (nenhum `with:` o sobrescreve; `grep -rn 'fetch-depth' .github/workflows/` só encontra `publish.yml:46`). Com um único commit no histórico local, `git merge-base origin/develop HEAD` falha — `origin/develop` sequer existe como ref.
- **Impact:** aplicar a EC-1 sem esta faz o portão **crashar** em todo PR, em vez de proteger. Falha barulhenta em vez de silenciosa, mas igualmente inutilizante.
- **Suggested fix:** no job que roda o portão, `with: { fetch-depth: 0 }` — ou, mais barato, aceitar o `BASE_SHA` do evento (`github.event.pull_request.base.sha`) por variável de ambiente e pular a comparação com aviso explícito quando ausente.

### EC-3: A heurística de acento não vê PT sem acento — e os dois arquivos que o próprio plano renomeia escapam

- **Affected task:** T0.1 (afeta a métrica do Goal); manifesta-se em T6.1
- **Kind:** NEGATIVE (falso negativo na própria métrica de sucesso)
- **Family:** Format
- **Scenario:** o tier D conta nomes de arquivo rastreados pelo git, e o matcher é "acento **ou** palavra-função PT". Os dois alvos declarados em T6.1 são `docs/integracao-theokit-mcp.md` e `packages/api/tests/integration/m28-execution-nao-confiavel.integration.test.ts`. **Nenhum dos dois tem acento**, e nem `integracao` nem `nao` nem `confiavel` estão numa lista de palavras-função. O mesmo vale para identificadores e comentários escritos sem acento (`versao`, `configuracao`, `execucao`, `nao`).
- **Impact:** o portão reporta `tierD = 0` com os dois arquivos ainda em português. O Goal do plano é medido por esse número — ele declararia sucesso sobre trabalho não feito. É a falha que este plano inteiro existe para não repetir.
- **Suggested fix:** normalizar com `String.prototype.normalize('NFD').replace(/\p{M}/gu,'')` antes de casar, e incluir na lista os radicais sem acento (`nao|integracao|execucao|versao|configuracao|descobrib|invariantes|dependencias`).

### EC-4: Carve-out com `sunset` inválido nunca expira — bypass permanente e silencioso

- **Affected task:** T0.1 (mecanismo); T6.3 (primeiro usuário)
- **Kind:** NEGATIVE
- **Family:** Input / Format
- **Scenario:** o plano manda ignorar carve-out cujo `sunset` esteja no passado. Com `new Date('em breve')` → `Invalid Date`, e toda comparação com `Invalid Date` devolve `false` — inclusive `sunset < now`. O carve-out é classificado como **não expirado** e vale para sempre.
- **Impact:** o único mecanismo de exceção do portão pode ser tornado permanente por um erro de digitação, sem nenhum sinal. Mesmo modo de falha que `code-quality-golden-rule.md` § 4 já classifica como finding HARD (`allowlist_malformed_entry`).
- **Suggested fix:** rejeitar a entrada em vez de interpretá-la — `if (Number.isNaN(Date.parse(c.sunset))) throw new Error(\`carve-out ${c.path}: sunset inválido\`)`.

### EC-5: O snapshot de superfície compara **nomes**, e T2.1 renomeia **campos** — a garantia declarada não existe

- **Affected task:** T1.3 (mecanismo), T2.1 (quem confia nele)
- **Kind:** NEGATIVE
- **Family:** Boundary / Integration
- **Scenario:** T1.3 produz uma lista de nomes exportados (`{name, kind}`). T2.1 renomeia, além dos cinco tipos, **cinco campos de interfaces exportadas**: `revisao`→`revision`, `vizinhas`→`neighbours`, `similaridade`→`similarity`, `publicada`→`published`, `temVetor`→`hasVector`. Renomear um campo de `EntradaDiagnostico` **não altera a lista de nomes exportados** — o snapshot passa verde. O plano afirma em D3 e na Coverage Matrix (#1) que o snapshot é o guarda dessa quebra.
- **Impact:** o guarda criado especificamente para tornar a quebra visível não a enxerga. Um consumidor TypeScript que construa `EntradaDiagnostico` quebra no `tsc`, e nada no pipeline sinalizou.
- **Suggested fix:** snapshotar o **conteúdo** do `.d.ts` emitido, não a lista de nomes — `expect(hash(readFileSync('packages/core/dist/index.d.ts'))).toBe(snapshot)`; ou, se o build no portão for caro demais, declarar honestamente em D3 que o gate cobre nomes e adicionar um teste de tipo `@ts-expect-error` por campo renomeado.

### EC-6: Versão preexistente com texto inválido faz `parseVersion` explodir num publish alheio

- **Affected task:** T4.1
- **Kind:** NEGATIVE
- **Family:** Input / State
- **Scenario:** `schema.ts:168` declara `version: text('version')` — texto livre, sem `CHECK` e sem validação até agora (`assertPublishable` nunca rodou — é o achado 2). O plano manda ler as versões existentes e mapear `parseVersion` antes de inserir. Uma linha histórica com `'v1.2'`, `'latest'` ou `''` faz o `map` lançar durante a publicação de uma versão **nova e válida**.
- **Impact:** a skill fica **impossível de publicar para sempre**, com erro 500 e stack trace, por causa de um dado antigo. A tarefa criada para endurecer a publicação passaria a quebrá-la.
- **Suggested fix:** filtrar antes de comparar — `const existing = rows.map(r => tryParse(r.version)).filter((v): v is SemVer => v !== null)`, e registrar em log as linhas descartadas.

### EC-7: Nenhuma tarefa mapeia a violação de unicidade para 409 — o critério de aceite de T4.2 não é implementável

- **Affected task:** T4.1 / T4.2
- **Kind:** NEGATIVE
- **Family:** Integration / Concurrency
- **Scenario:** T4.2 aceita como critério que, sob concorrência, "as demais recebem 409 (da guarda) **ou violação de unicidade mapeada para 409 (do índice)**". A tarefa 3 de T4.1 só mapeia `VersionRejectedError`. Nenhuma tarefa das duas adiciona o tratamento do erro do Postgres. O caminho que o índice cobre — justamente o que a guarda não vê — devolve o erro cru.
- **Impact:** o teste de concorrência de T4.2 (N=10 `Promise.all`) falha: 1 sucesso, e as outras 9 devolvem **500**, não 409. O critério de aceite da própria tarefa não pode ser satisfeito pelas tarefas listadas.
- **Suggested fix:** reusar o helper que já existe — em `skills-store.ts`, `catch (err) { if (isUniqueViolation(err)) throw new VersionRejectedError('duplicate', ...) }` (`packages/api/src/server/persistence/pg-errors.ts:14`, já usado em `skills-store.ts:290`).

### EC-8: A janela de T6.2 trava todo PR aberto que não seja o próprio PR do rename

- **Affected task:** T6.2
- **Kind:** NEGATIVE
- **Family:** Timing / Permission
- **Scenario:** o procedimento troca os contextos exigidos pelos **novos** nomes (passo 4) e então mergeia. Qualquer PR aberto que tenha ramificado **antes** do rename roda os workflows com os nomes antigos e reporta os contextos antigos. A proteção passa a exigir contextos que esses PRs nunca reportarão.
- **Impact:** todo PR concorrente fica bloqueado sem saída até ser rebaseado — exatamente o modo de falha que o critério de aceite da própria tarefa promete evitar ("Nenhum PR aberto ficou travado"). O procedimento como escrito garante o oposto.
- **Suggested fix:** acrescentar ao procedimento, entre os passos 4 e 6: "listar `gh pr list --state open` e, para cada um, mergear `develop` na branch do PR" — ou executar a janela com zero PRs abertos e declarar isso como pré-condição.

### EC-9: T5.x se contradiz — a tarefa renomeia identificadores, o critério de aceite proíbe tocar em código

- **Affected task:** T5.1–T5.5
- **Kind:** NEGATIVE (defeito de consistência do plano)
- **Family:** State
- **Scenario:** a tarefa 2 de cada T5.x manda "renomear identificadores locais em PT do pacote" — que é mudança de código. O critério de aceite exige que "o JS emitido do commit de comentários puros seja byte-idêntico ao anterior", e o *Why this step* declara "sem tocar em nenhuma linha de código no mesmo commit". Renomear `chave`→`key` altera o JS emitido.
- **Impact:** o critério de aceite é insatisfazível como escrito; quem implementar vai ou abandonar a verificação (perdendo a única prova mecânica de que a tradução não alterou comportamento) ou pular os renames (deixando o tier A/C incompleto).
- **Suggested fix:** dois commits por pacote — `docs(<pkg>): translate comments` (com a prova de emit byte-idêntico) seguido de `refactor(<pkg>): rename PT identifiers` (com a suíte do pacote como prova).

---

## SHOULD TEST

### EC-10: O caso de três causas simultâneas — onde uma duplicata melhor se esconde

- **Affected task:** T1.2
- **Kind:** EDGE (extremo válido: o máximo de causas possível)
- **Scenario:** descrição curta + publicada sem vetor + vizinha acima de 0.90 disparam as três causas juntas. T1.2 lista quatro casos a proteger — três isolados e um combinado com **duas** causas. O caso máximo fica descoberto, e é onde um `hints.push` duplicado se dissolve melhor no meio do ruído.
- **Suggested test:** `test_all_three_causes_yield_exactly_three_unique_hints()` — asserta `causes.length === 3`, `hints.length === 3` e `new Set(hints).size === 3`.

### EC-11: A fórmula de cardinalidade do plano é falsa para o rascunho

- **Affected task:** T1.2
- **Kind:** EDGE (fronteira: zero causas)
- **Scenario:** o pseudo-código de T1.2 prescreve `expect(d.hints).toHaveLength(expectedCauseCount)`. No ramo do rascunho sem causa alguma (`discoverability.ts:139-143`), `causes.length === 0` e `hints.length === 1`. Aplicar a fórmula mecanicamente quebra o teste que `65d877e` acabou de escrever.
- **Suggested test:** manter o caso do rascunho com o literal `toHaveLength(1)` (como já está em `discoverability.test.ts:197`) e aplicar a fórmula só aos ramos com causa — asserta explicitamente que hints do rascunho é 1 com 0 causas.

### EC-12: Orçamento ausente ou malformado deve falhar com mensagem, não com stack trace

- **Affected task:** T0.1
- **Kind:** NEGATIVE
- **Scenario:** primeira execução após um rebase mal resolvido deixa `language-budget.json` com JSON inválido, ou ausente. `JSON.parse` lança e o Vitest reporta `SyntaxError: Unexpected token` sem dizer qual arquivo nem o que fazer.
- **Suggested test:** `test_gate_fails_clearly_when_budget_is_malformed()` — asserta a mensagem tipada contendo o caminho do arquivo e a instrução de regeneração (`rules/error-handling.md` § 2: falhar **claro**, não só falhar).

### EC-13: Metadado de build (`1.2.0+build`) — guarda e índice discordam na fronteira

- **Affected task:** T4.1 / T4.2
- **Kind:** EDGE (extremo válido do formato semver)
- **Scenario:** semver ignora metadado de build na precedência, então `compareVersions('1.2.0+a','1.2.0+b') === 0` e `assertPublishable` recusa como duplicata. O índice único de T4.2 é sobre a coluna `text` — as duas strings são distintas e ambas passariam. Guarda e banco divergem exatamente onde deveriam concordar.
- **Suggested test:** `test_build_metadata_is_rejected_as_duplicate()` — publica `1.2.0+a` e depois `1.2.0+b`; asserta 409 com `reason='duplicate'`. Se o parser hoje rejeita `+build` na entrada, o teste documenta isso e o caso se fecha sozinho.

### EC-14: A prova de "emit byte-idêntico" precisa excluir o `.d.ts`

- **Affected task:** T5.1–T5.5
- **Kind:** EDGE
- **Scenario:** `packages/core` emite declarations (`dist/index.d.ts` existe; `packages/api/tsconfig.build.json:7` confirma `declaration: true` no padrão do repo) e o `tsc` **preserva JSDoc no `.d.ts`**. Traduzir um bloco `/** ... */` altera legitimamente os bytes do `.d.ts`, e a verificação como escrita ("saída byte-idêntica") reprovaria um commit correto.
- **Suggested test:** escopar a comparação aos `.js` emitidos — `test_emitted_js_is_unchanged_for_<pkg>()` compara apenas `dist/**/*.js`, e um segundo teste asserta que a lista de nomes no `.d.ts` não mudou (reusando o mecanismo de T1.3).

### EC-15: A asserção mais forte de T1.1 pode reprovar por uma linha de log não relacionada

- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Scenario:** trocar `not.toContain('THEOSKILL_REGISTRY é obrigatório')` por `not.toContain('THEOSKILL_REGISTRY')` amplia o alcance para **todo** o stderr. Basta uma linha de diagnóstico futura ecoando o nome da variável (ex.: `using THEOSKILL_REGISTRY=...`) para o teste reprovar sem que o comportamento protegido tenha regredido.
- **Suggested test:** asseverar sobre a linha de erro, não sobre o buffer inteiro — `const errLine = stderr.split('\n').find(l => l.startsWith('theo-skills mcp:'))`, e aplicar `toContain`/`not.toContain` sobre ela.

---

## DOCUMENT

### EC-16: Commits só de documentação não disparam o CI em `workspace` — o tier D fica sem observação no push

- **Kind:** NEGATIVE
- **Accepted risk:** `ci.yml` filtra `push: branches: [workspace]` com `paths-ignore: ['.claude/**','**/*.md','docs/**']`. A Fase 6 é majoritariamente `.md`, então esses commits **não** acionam o portão no push. O gate roda no PR de promoção `workspace → develop`, que é onde a decisão de mérito acontece — a exposição é a janela entre o push e a abertura do PR, e o custo de removê-la (rodar a suíte inteira a cada correção de vírgula em README) é maior que o risco. Registrar no plano para que a ausência de sinal não seja lida como aprovação.

### EC-17: O contrato JSON **não** é afetado pelos renames de T2.1 — verificado, não presumido

- **Kind:** EDGE
- **Accepted risk:** nenhum — é uma incerteza que se fecha. Verificado em `packages/api/src/server/handlers/discoverability.ts:89-96`: a resposta é `c.json({ ...diagnostico, embedder })`, e os campos de `Diagnostico` (`discoverable`, `causes`, `hints`) **já estão em inglês**. Os campos renomeados (`revisao`, `temVetor`, `vizinhas`, `similaridade`) pertencem a `EntradaDiagnostico`, construída no servidor a partir do corpo snake_case (`body.has_embedding`, linhas 76-80) e nunca serializada. Registrar no plano evita que a dúvida seja re-litigada durante a implementação, ou pior, que alguém "corrija" o wire format por precaução.

### EC-18: Arquivo rastreado mas ausente do working tree deve ser pulado, não derrubar o portão

- **Kind:** NEGATIVE
- **Accepted risk:** `git ls-files` lista o índice; num checkout esparso ou durante um `git mv` interrompido, um caminho listado pode não existir no disco e `readFileSync` lança `ENOENT`. É improvável no fluxo normal e o custo do tratamento é uma linha, mas não justifica uma tarefa própria: registrar como nota de implementação para que o scanner use `try/catch` por arquivo e reporte os pulados na saída, em vez de abortar a varredura inteira.

---

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 1 | 5 | 4 | 1 | 1 |
| T1.1 | 0 | 1 | 0 | 1 | 0 |
| T1.2 | 2 | 0 | 0 | 2 | 0 |
| T1.3 | 0 | 1 | 1 | 0 | 0 |
| T2.1 | 1 | 1 | (EC-5) | 0 | 1 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 | 0 |
| T3.3 | 0 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 2 | 2 | 1 | 0 |
| T4.2 | 1 | 1 | (EC-7) | (EC-13) | 0 |
| T5.1–T5.5 | 1 | 1 | 1 | 1 | 0 |
| T6.1 | 0 | 0 | (EC-3) | 0 | 0 |
| T6.2 | 0 | 1 | 1 | 0 | 0 |
| T6.3 | 0 | 0 | (EC-4) | 0 | 0 |

**Coverage check:** T0.1, T1.3, T4.1, T4.2 e T6.2 — as tarefas com fronteira real de entrada, estado ou concorrência — têm ao menos um caso EDGE **e** um NEGATIVE considerados. T2.2, T3.1, T3.2 e T3.3 são substituição de literais sem nova fronteira: a lente EDGE não se aplica (não há valor extremo num texto traduzido), e a lente NEGATIVE já está coberta pelos testes que as próprias tarefas declaram (código de erro preservado, prefixo uniforme). T5.x tem as duas lentes cobertas por EC-9 e EC-14. T6.1 herda a fronteira de formato da EC-3.

**Verdict:** PLAN NEEDS ADJUSTMENT

Nove MUST FIX. Quatro deles (EC-1, EC-2, EC-3, EC-4) atingem o portão de que o Goal depende, e três desses fazem o portão **reportar sucesso sem tê-lo** — a mesma classe de falha que os achados 1, 4 e 7 do `/code-review` descrevem, agora reproduzida dentro do plano escrito para corrigi-los. Dois (EC-7, EC-9) são contradições internas: um critério de aceite que nenhuma tarefa listada torna satisfazível. Nenhum exige nova abstração; os nove somados cabem em ~15 linhas de código e três parágrafos de procedimento.

O plano deve ser revisado para v1.1 absorvendo os nove antes de `/plan-confidence`.
