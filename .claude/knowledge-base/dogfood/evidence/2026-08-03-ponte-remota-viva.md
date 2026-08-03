---
scenario: theokit-remote-provider
date: 2026-08-03
operator: claude-code (sessão theo-skills) + coordenador
outcome: pass
summary: Um agente Theokit descobriu por intenção uma skill que não conhecia e carregou o corpo do registry, sem disco.
---

# O cenário-âncora aconteceu

A âncora declarada é: *"um agente Theokit real consome o registro publicado — descobre por
intenção uma skill que não conhecia e carrega o corpo dela do registry no ar, sem passar pelo
disco"*.

## O que foi exercitado

`usetheo-labs/agent-builder` configurado em `.mcp.json` com o servidor `theo-skills`
(`type: http`, `url: http://127.0.0.1:18097`, `headers.Authorization`). Do outro lado, o ouvinte
MCP do build apontando para a API com `THEOSKILL_AUTH_REQUIRED=true`.

- **Chave por inquilino**, escopo mínimo: `{workspace_id: default, scopes: [skills:read]}`. A
  publicação usou chave **separada**, de escrita.
- **`initialize` sem bearer → `401`; com bearer → `200` + `mcp-session-id`.**
- **Descoberta por intenção:** `search_skills{"query":"preciso passar dolar para real"}` — a
  consulta **não contém** `reconciliador`, `cambio` nem `converte` — devolveu
  `reconciliador-de-cambio` em **primeiro** (0.0333 contra 0.0164 das demais).
- **Carga do corpo:** `load_skill` trouxe o texto íntegro do registry.
- **Sem disco:** `find` no `agent-builder` por `*reconciliador*` → **0 arquivos**.

Evidência bruta: `acceptance/evidence/M28-ponte-remota-viva.txt`.

## Por que `pass` e não `partial`

A evidência de 2026-08-03 anterior (`primeira-publicacao`) ficou `partial` porque **a descoberta
por intenção não tinha sido exercitada** — faltava o consumidor do outro lado. Agora foi, e as
duas metades da âncora se fecharam na mesma sessão.

## O que ainda NÃO é `running`

O contrato de `dogfood-golden-rule.md` pede **≥3 evidências em ≥3 datas distintas** e **≥1
`outcome: fail`**. Hoje há duas evidências, **ambas de 2026-08-03**, e nenhuma `fail`. O status
segue `wired`: uma sessão não é uso continuado, e nenhum commit encurta isso.

## O engano que este exercício desfez

Antes desta sessão, o M28 afirmava que a ponte *"não existe, e a razão é estrutural — não é
configuração faltando"*. Era o contrário: as duas pontas existiam e nunca tinham sido ligadas. O
ouvinte estava fora do ar, e a variável de emissão de chave (`THEOSKILL_PLATFORM_ADMIN_KEY`) não
seguia o nome usado nos produtos vizinhos — duas buscas por analogia falharam antes de alguém
medir.
