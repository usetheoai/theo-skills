# prototype — jornadas e features (alinhamento)

Protótipo visual para alinhar **o que vamos construir** antes de escrever código de produto.
Mostra as 4 jornadas de persona do [PRD § 3](../PRD.md), marcando cada passo pelo que existe no
código **hoje** — não pelo que o roadmap promete.

```bash
pnpm install --ignore-workspace   # --ignore-workspace: isto NÃO é um pacote do monorepo
pnpm dev                          # http://localhost:5173
```

## O que tem dentro

| Aba | O que é |
|---|---|
| **Catálogo** | A tela que o Agent Builder usa: busca por intenção, filtro por tag, grid de skills. Clicar num card abre o detalhe. |
| **Detalhe da skill** | Identidade, revisões (imutáveis), payload com o `SKILL.md` renderizado, entrega de webhook e a `DangerZone` de deleção. |
| **4 jornadas** | Skill Author · Agent Builder · Runtime do agente · Operador/SRE — passo a passo, com o estado real de cada um. |
| **Decisões** | As quatro escolhas em aberto que mudam o que vamos construir. |

Deep-links: `#skill=k8s-triage` abre uma skill; `#tab=runtime` abre uma jornada.

## Roda sobre o design system real do Theo

Mesma stack visual do `cloud/dashboard`, para a conversa acontecer na linguagem do produto:

| Peça | Pacote |
|---|---|
| Componentes (`PageShell`, `Card`, `Tabs`, `Stepper`, `CodeBlock`, `Badge`, `Alert`, `StatusDot`) | `@usetheo/ui@0.31` |
| Tema Violet Forge + `TheoUIProvider` (dark travado) | `@theokit/ui@1.3.2` |
| Utilities | Tailwind v4 (`@tailwindcss/vite`) |
| Fonte | Geist / Geist Mono, self-hosted via `@theokit/ui/fonts.css` |

Regras do [`DESIGN.md`](../../theo-cloud/dashboard/DESIGN.md) respeitadas: zero hex inline, zero
spacing solto, zero emoji na UI, zero glassmorphism, composites em vez de markup ad-hoc.

**Uma divergência deliberada do dashboard:** ele *vendoriza* os token layers CSS em
`src/vendor/usetheo-ui/`; aqui eles vêm direto de `@theokit/ui`, que os exporta. Conferido por
diff em 2026-07-30 — `tokens-v4.css` idêntico, `tokens.css` idêntico exceto `--input: oklch(0.34)`
(borda perceptível), que é justamente a correção que o dashboard aplicou à mão. Menos uma cópia
para envelhecer. Se o dashboard divergir, ele é a fonte da verdade.

## O que ele NÃO é

- **Não é código de produto.** Vive fora de `packages/`, não entra no `pnpm-workspace.yaml`, não é
  buildado nem publicado pelo monorepo, e não tem teste — não há regra de negócio aqui, só dados
  declarativos em `src/data/journeys.ts` e componentes que os renderizam.
- **Não é a UI do produto.** O theo-skills é API-first; isto é um instrumento de conversa.
- **Não é fonte da verdade.** O código é. Quando divergirem, o código ganha e este protótipo é
  corrigido ou deletado.

## Regra do `src/data/journeys.ts`

Nada ali é inventado. Conferido no código em 2026-07-30:

| No protótipo | Conferido em |
|---|---|
| 9 rotas `/v1/*` | `packages/api/src/server/handlers/*.ts` |
| 7 subcomandos `theoskill` | `packages/cli/src/args.ts` |
| `OperationState`, `WebhookEventType`, `RetrieveStrategy` | `packages/core/src/contract/index.ts` |
| Status por milestone | `ROADMAP.md` (headers `## M<N> — [x]`) |

Ao mudar a API, atualize este arquivo ou apague o protótipo. Um protótipo que mente sobre o
contrato é pior que nenhum.

## Descarte

`rm -rf prototype/` — nada no monorepo depende disto.
