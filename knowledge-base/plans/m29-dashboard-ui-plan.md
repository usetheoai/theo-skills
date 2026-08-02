---
slug: m29-dashboard-ui
target_project: theo-cloud
milestone_id: M29
created_at: 2026-08-02
goal: dar ao registro de skills a mesma interface dos demais produtos no dashboard do theo-cloud
---

# M29 — PLAN: a interface do registro no dashboard

## Baseline (medido no DISCOVER — `discoveries/blueprints/m29-dashboard-ui-blueprint.md`)

| camada | estado |
|---|---|
| `internal/skills/{broker,admin_client}.go` + `SKILLS_BASE_URL` no `main.go` | **PRONTO** |
| escopos `skills:read/write/publish` em `api_keys.go:71-73` | **PRONTO** |
| `internal/routes/skills_dashboard.go` | **FALTA** |
| `internal/skills/upstream_error.go` | **FALTA** (o trust tem; sem ele 422 vira 502) |
| telas + menu + mocks + e2e | **FALTA** |
| `@usetheo/ui` | pacote npm `^0.31.0`, **já instalado** |

## DECISÃO 1 — a DoD item 3 pede um número que NÃO EXISTE

A DoD exige que a confirmação diga *"quantos consumidores passam a receber conteúdo diferente"*.

**Medido:** `GET /v1/skills/:id/channels` devolve `{ channel, revision_id, previous_revision_id }`
(`handlers/publishing.ts:58-59`). Não há tabela de assinantes de canal — os únicos assinantes do
sistema são de **eventos** (`webhook-endpoints.ts:25`), que é outra coisa. O número não existe e
não é derivável do que a API devolve.

**Alternativas consideradas:**

| opção | custo | por que não |
|---|---|---|
| (a) produto ganha contagem de consumidores | rastrear resolução por canal = novo produto | escopo de outro milestone; M29 é interface |
| (b) inventar/estimar o número | zero | **proibido** — número fabricado numa confirmação destrutiva é pior que nenhum |
| (c) dizer o que DE FATO deixa de valer | baixo | **ESCOLHIDA** |

**Escolha (c):** a confirmação nomeia a revisão que **deixa de ser servida**:
> "Quem resolver `@stable` deixa de receber a revisão `{previous_revision_id}` e passa a receber
> `{revision_id}`. Não há como desfazer promovendo de volta — a revisão anterior continua
> existindo, mas o consumidor já leu a nova."

Isso satisfaz a **intenção** da DoD ("o texto diz o que deixa de valer") e não a **letra**
("quantos"). **A letra fica registrada como não atendida**, com a razão medida — não como
atendida por interpretação generosa.

## DECISÃO 2 — corrigir a instrução que causou o defeito

`app-sidebar-menus.ts:91` diz **"4. (Optional) Extend resolveActiveMenu()"**. A linha `:332`
registra que a ausência dessa linha deixou **quatro telas do trust órfãs**. A instrução marcada
"opcional" é a que produziu o defeito que a DoD item 1 existe para impedir.

Trocar `(Optional)` por `(OBRIGATÓRIO quando a capacidade tem submenu)` é parte do M29 — senão a
DoD protege só este produto e o próximo repete.

## Fases

### Fase 1 — BFF de leitura (Go, `theo-cloud`)

| T | tarefa | TDD (RED primeiro) |
|---|---|---|
| T1.1 | `internal/skills/upstream_error.go` — porta do padrão do trust | `test_preserva_422_e_corpo`: upstream 422 com `{"code":"INVALID_FRONTMATTER"}` → o erro tipado carrega os dois. Mutação que discrimina: colapsar em 502 faz cair. |
| T1.2 | `internal/skills/data_client.go` — list/get/versions/channels/resolve | `test_404_do_upstream_nao_vira_500` + `test_chave_e_do_inquilino` (broker chamado com o workspace do principal, nunca de parâmetro) |
| T1.3 | `internal/routes/skills_dashboard.go` — `GET /v1/dashboard/skills{,/:id,/:id/versions,/:id/channels}` | `test_sem_principal_401`; `test_inquilino_alheio_404_nao_403` (404 é a resposta que não confirma existência) |
| T1.4 | `cmd/skills_dashboard_wiring.go` — composição | teste de arranque: rota registrada quando `SKILLS_BASE_URL` está setado |

### Fase 2 — lógica pura, FORA do React

| T | tarefa | TDD |
|---|---|---|
| T2.1 | `dashboard/src/components/skills/projections.ts` — versões → linhas ordenadas; canal → revisão vigente | `test_versao_sem_canal_nao_some_da_lista`; `test_duas_versoes_no_mesmo_canal_e_estado_impossivel` |
| T2.2 | `.../confirm-text.ts` — texto da promoção (DECISÃO 1) | `test_texto_nomeia_a_revisao_que_sai_e_a_que_entra` — asserção sobre CONTEÚDO, não sobre "não vazio" |

### Fase 3 — telas + menu

| T | tarefa | verificação |
|---|---|---|
| T3.1 | `pages/skills.tsx` (overview) + `pages/skills/{detail,versions}.tsx` | componentes de `@usetheo/ui`; `DESIGN.md` lido ANTES |
| T3.2 | **as três peças do menu** — entrada `drillsInto: 'skills'`, objeto `skills:`, **e a linha em `resolveActiveMenu`** | **clicar a partir da raiz**; digitar a URL NÃO conta |
| T3.3 | corrigir o `(Optional)` do `:91` (DECISÃO 2) | — |
| T3.4 | rota lazy em `app.tsx` | — |
| T3.5 | promoção de canal com `ConfirmDialog` canônico + frase digitada | texto vem de T2.2 |

### Fase 4 — mocks + e2e (UM e2e da jornada inteira)

| T | tarefa |
|---|---|
| T4.1 | `lib/mocks/skills-handlers.ts` |
| T4.2 | `e2e/skills-journey.spec.ts` — **navega pelo menu**, lista → detalhe → versões/canais → instrução resolvida, asserindo **conteúdo**; termina na promoção com confirmação |

## Matriz de cobertura (DoD → tarefa)

| DoD | tarefa | risco se faltar |
|---|---|---|
| 1. menu abre clicando, três peças | T3.2 + T4.2 | **falha silenciosa** — telas vivas, inalcançáveis |
| 2. jornada de leitura ponta a ponta, asserindo conteúdo | T1.2-T1.3 + T4.2 | tela verde servindo vazio |
| 3. `ConfirmDialog` + o que deixa de valer | T2.2 + T3.5 | destrutivo que não parece |
| 4. lógica fora do React + mocks | T2.1-T2.2 + T4.1 | lógica só testável com browser |
| 5. UM e2e da jornada | T4.2 | e2e por tela não pega a costura |

## Riscos

| risco | mitigação |
|---|---|
| `resolveActiveMenu` esquecido | T3.2 exige clique + T3.3 corrige a instrução |
| 422 colapsado em 502 | T1.1 é a PRIMEIRA tarefa, com mutação que discrimina |
| e2e que passa sem backend | mocks explícitos (T4.1); asserção de conteúdo (T4.2) |
| escopo vazar para escrita | só promoção de canal escreve; publicar/republicar fora |

## Questões em aberto

1. **A contagem de consumidores vira milestone próprio?** Decisão do dono. M29 entrega (c).

## PENDÊNCIA DE PROCESSO (coordenador, 2026-08-02) — executar ao FECHAR este goal

O milestone deve viver em **`theo-cloud/ROADMAP.md`**, não em `theo-skills/ROADMAP.md`.

**Argumento (mecânico, verificado):** `rules/cycle-release.md` fase `roadmap-checkbox-flip` vira o
checkbox no ROADMAP do repo declarado em `target_project`. Este plano declara
`target_project: theo-cloud` — logo o release viraria o checkbox lá, e o M29 no
`theo-skills/ROADMAP.md` ficaria `[ ]` **para sempre**, mesmo entregue.

**Precedente:** a UI do theo-trust é o **M23 do `theo-cloud/ROADMAP.md`**, e está `[x]`.

**Ações (não antes de fechar o goal):**
1. Mover o M29 para `theo-cloud/ROADMAP.md`, **preservando o conteúdo** (auditado pelo
   coordenador; única correção necessária foi a DoD de promover canal — ver DECISÃO 1).
2. Renumerar para o próximo `M` livre de lá.
3. Deixar **PONTEIRO** em `theo-skills/ROADMAP.md` para onde a UI é entregue. **Não remover sem
   rastro** — foi exatamente o cross-reference ausente que custou cinco semanas de roadmap
   contraditório no theo-promptly.

Crédito da divergência: sessão theo-promptly-2, que a trouxe em vez de decidir calada.

## ACHADO T1.2 — não copiar o `getRaw` da referência

`theo-cloud/internal/trust/data_client.go:144-149` **não usa** o `UpstreamError` do próprio
pacote: colapsa a recusa em `fmt.Errorf("...%d: %s", status, truncate(body,300))`. É o mesmo
defeito que o tipo existe para impedir — o tipo foi criado no M24 e o `getRaw` ficou para trás.

**Consequência para a T1.2:** copiar o `getRaw` da referência porta o defeito junto com o padrão.
O `getRaw` do skills DEVE construir `&UpstreamError{Status, Body, Method, Path}` em `4xx`.
O teste que discrimina: upstream 422 tipado → `AsUpstreamError` extrai `code`; a versão com
`fmt.Errorf` passa em "a mensagem contém INVALID_FRONTMATTER" e falha em extrair o código.

Vale abrir issue no theo-cloud para o `getRaw` do trust (defeito vivo, não meu escopo).

**Segurança estrutural já presente no broker (aproveitar, não reinventar):**
`Broker.KeyForTenant(ctx, accountID, tenantID)` + `DataClient.WithKeyResolver(func(ctx))` — a
chave sai de um resolvedor ligado ao contexto, então a UI **não tem como** passar `workspaceId`
por parâmetro. Manter essa forma: é a diferença entre impedir o erro e testar contra ele.
