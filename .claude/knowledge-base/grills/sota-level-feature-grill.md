---
slug: sota-level
generated_by: roadmap-feature
date: 2026-08-03
status: completed
target_milestones: [M32, M33, M34, M35]
---

# Grill — "tornar o sistema SOTA level"

## Contexto de entrada

Invocado com `/roadmap-feature "Crie um ou mais milestones para tornar nosso sistema SOTA LEVEL"`.
O pedido chegou vago por natureza; as candidatas abaixo não foram inventadas na hora — cada uma tem
evidência medida nesta mesma sessão (auditorias de UX, blueprint `skills-catalog-ux`, leitura do
schema e do roadmap).

**Pré-flight:** ROADMAP.md com 31 milestones (M0–M31), abertos M7 e M31. Próximo ID livre: M32.
Árvore de trabalho suja (4 artefatos desta sessão) → auto-commit do Step 6.6 será pulado.

**Advisory emitido:** o contrato do `/roadmap-feature` sugere avaliar `ROADMAP-v2.md` acima de ~15
milestones. Este tem 31. O usuário optou por continuar estendendo.

## Q1 — Quais candidatas viram milestone?

**Resposta:** todas as quatro.

| Candidata | Evidência medida | Vira |
|---|---|---|
| Ciclo de vida (deprecar sem quebrar) | `schema.ts:71` só tem `ACTIVE`/`DELETED`; peer separa `is_enabled` de `status` (`types/skill.ts:73,95`) e testa `excludes disabled items from featured` (`DiscoverTab.test.tsx:325`) | M32 |
| Catálogo de descoberta (galeria) | R1–R6 do blueprint `skills-catalog-ux` (SHIPPABLE_WITH_CAVEATS 89) | M33 |
| Evals de qualidade de skill | **COLIDE com out-of-scope** — ver Q1.1 | M34 |
| Bundles e adoção com tela | M20/M21 `[x]` com zero superfície (auditoria 2026-08-03 § "Quem publica para terceiros") | M35 |

## Q1.1 — Cross-check de out-of-scope (Step 3, obrigatório)

O roadmap declara em `### Explicitly out of scope`:

> "Execução/runtime de skills — *why excluded:* é responsabilidade do **Theokit**, não do registry.
> Nós armazenamos e descobrimos; **ele executa**."

Um eval que roda a skill contra casos de teste **executa a skill**. Colisão frontal, não heurística.

Segunda verificação, esta **falso-positivo provável**: "Marketplace público / skills da comunidade"
contra o catálogo de descoberta (M33). Não colidem — o M33 é navegação do acervo **do workspace**,
sem moderação, curadoria pública nem contribuição de terceiros. Registrado como
`out_of_scope_overlap_false_positive: "Marketplace público / skills da comunidade"`.

**Resposta:** **eval híbrido — estático agora, execução depois.**

O item **NÃO** foi removido do `### Explicitly out of scope`. A fronteira "execução é do Theokit"
permanece intacta; o M34 entrega análise estática (descrição, frontmatter, colisão de intenção,
descobribilidade) e a execução fica registrada como decisão futura, conjunta com o Theokit. Nenhuma
edição foi feita na seção de out-of-scope.

`out_of_scope_overlap_false_positive: "Marketplace público / skills da comunidade"` — o M33 é
navegação do acervo do workspace, sem moderação, curadoria pública nem contribuição de terceiros.

## Q2 — Dependências

**Resposta:** M33 e M35 dependem do M31; M32 e M34 não.

| Milestone | Dependências | Razão |
|---|---|---|
| M32 | M14 `[x]`, M23 `[x]` | Nasce no domínio/API; a tela vem depois |
| M33 | **M31** | Herda o padrão de `EmptyState`, erro e navegação — construir antes duplicaria as decisões |
| M34 | M4 `[x]`, M30 `[x]` | Nasce como API + CLI; a autoria o consome quando existir |
| M35 | **M31**, M20 `[x]`, M21 `[x]` | É tela, e herda o mesmo padrão |

Consequência: M32 e M34 ficam elegíveis de imediato e podem correr em paralelo ao M31; M33 e M35
esperam o M31 virar `[x]` por `/acceptance`.

## Q3 — Definition of done

Derivada da evidência medida nesta sessão, não perguntada em aberto — cada bullet dos quatro
milestones cita um fato verificável (linha de schema, teste do peer, endpoint sem superfície). Ver
os blocos `### M32`–`### M35` em `ROADMAP.md`. O usuário revisa no diff.

Duas escolhas de DoD que merecem destaque por serem **restrições**, não funcionalidades:

- **M33:** "nenhum número que não meçamos" — sem estrelas e sem downloads, porque não medimos
  avaliação nem carregamento por skill (`rules/public-copy.md` § 5).
- **M34:** "nenhuma execução da skill acontece" — a fronteira é item de DoD verificável, não
  promessa de prosa.

## Q4 — Riscos novos

Dois por milestone, registrados nos blocos do `ROADMAP.md`. Os dois de maior severidade:

1. **M32 — mudar o default de `:retrieve`** (excluir deprecadas) é mudança de comportamento para
   consumidor existente. Mitigação: medir quem consome antes de virar o default; entregar o opt-in
   primeiro.
2. **M35 — emitir token delegado pela sessão do dashboard** amplia o que uma sessão comprometida
   pode fazer. Mitigação: exibição única, revogação em um passo, emissão auditada. Superfície nova
   **declarada**, não reduzida a zero.

## Advisory registrado

O roadmap passou de 31 para **35 milestones**. O contrato do `/roadmap-feature` sugere avaliar um
`ROADMAP-v2.md` acima de ~15. O usuário optou por continuar estendendo — registrado aqui para que a
decisão seja rastreável, não esquecida.
