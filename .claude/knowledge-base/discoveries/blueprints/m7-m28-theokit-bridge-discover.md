---
slug: m7-m28-theokit-bridge
milestone_id: M7, M28
target_project: theo-skills
date: 2026-08-03
fase: DISCOVER (parcial — ver § Onde parei)
---

# M7 + M28 — DISCOVER: a ponte remota, e o que realmente falta

## 1. M7 e M28 NÃO se sobrepõem (a dúvida que abriu o discover)

| | M7 | M28 |
|---|---|---|
| entrega | validação por **uso continuado** (dogfood) | a **ponte** de descoberta em runtime, sem passar pelo disco |
| bloqueio | **calendário** | **decisão de arquitetura entre dois produtos** |

## 2. M7: o código está feito; o que falta é tempo

| Bullet | Estado MEDIDO |
|---|---|
| `RemoteSkillsManager` (list + retrieve + cache + fallback) | **EXISTE** — `packages/sdk/src/remote-skills-manager.ts`, 134 linhas, exportado em `index.ts:3`, coberto por `sdk.contract.test.ts:100` |
| formato casa com `CreateSkillSpec` | **provado** contra `Skill.create` real (SDK 4.36.0) |
| **dogfood real** | **é o que falta** |

O próprio M7 é explícito sobre as duas lacunas, e nenhuma é de engenharia:

- **(a) Recall@5 de uso real** — *"medi-lo com consultas que eu mesmo escrevi contra skills que
  eu mesmo publiquei mede a minha expectativa, não o uso"*.
- **(b) status `running`** — ≥3 evidências **em dias distintos** + ≥1 história de falha
  (`outcome: fail`). As três atuais são **do mesmo dia**. *"Nenhum commit encurta isso."*

**Consequência para o planejamento:** um `/auto-plan M7` não pode fechá-lo. Ele fecha com
calendário e uso de terceiros, não com sprint.

## 3. M28: o primeiro passo é um ADR, e ele atravessa dois produtos

O bullet 1 pede **decidir ONDE a ponte vive**:

- (i) um provider **no Theokit** que consome o nosso SDK, ou
- (ii) um adaptador **aqui** que materializa a skill no layout que o Theokit lê.

O Theokit **não está neste workspace** — há o `theokit-app` (fixture, 1 arquivo) e o pacote npm
`@theokit/sdk`. A decisão depende de quem é dono do outro lado. É o próximo trabalho real, e
começa por ADR.

## 4. ERRO METODOLÓGICO desta sessão — registrar para não repetir

Afirmei que `RemoteSkillsManager` não existia e **reabri o M16** por isso. Existe.

Causa: busquei o nome literal a partir do umbrella; a busca voltou vazia e o
`... | head -8 || echo "NENHUM"` **nunca dispara**, porque o `head` sai com 0. Li silêncio como
ausência. Pior: o bullet do M7 dizia *"`RemoteSkillsManager` **(ou provider equivalente)**"* — o
aviso estava na tela. E citei "duas fontes independentes" quando uma delas era um erro de shell.

**Regra derivada:** ausência só se afirma com o comando dizendo explicitamente que não achou
(`grep -c` = 0, ou `test -z`), nunca por saída vazia num pipe terminado em `head`.

## 5. Onde parei

DISCOVER cobriu a relação M7↔M28 e o estado real de M7. **Não cobriu:** quem é dono do Theokit,
qual das duas formas de ponte o time do outro lado aceita, e o que o `agent-builder` precisa
receber. Isso é o ADR do M28 — próximo passo, com contexto inteiro.
