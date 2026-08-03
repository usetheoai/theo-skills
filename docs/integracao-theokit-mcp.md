# Ligar um agente Theokit ao registro via MCP

Pedido de configuração para `usetheo-labs/agent-builder`. **Não editamos o arquivo de lá** — ele
é versionado e o repositório está com release em preparo (`chore(release): 0.107.1`, PR #250).
Mexer em config versionada de outro projeto no meio de um release custa confiança entre times.

## O bloco

`usetheo-labs/agent-builder/.mcp.json` declara hoje um único servidor (`add-fixture`).
Acrescentar, **sem remover o existente**:

```json
{
  "mcpServers": {
    "add-fixture": { "...": "manter como está" },
    "theo-skills": {
      "type": "http",
      "url": "http://127.0.0.1:18097"
    }
  }
}
```

> **`"type": "http"`, não `"streamable-http"`** — medido em
> `@theokit/sdk/dist/types/mcp.d.ts:67-71`:
> `McpHttpServerConfig = { type?: "http" | "sse"; url: string; headers?: Record<string,string> }`.
>
> A primeira versão deste documento dizia `"streamable-http"`, por analogia com a flag do nosso
> binário (`--transport streamable-http`). São coisas diferentes: aquela é a nossa flag de
> processo; esta é a chave que o SDK do outro lado desserializa. Entregar config por analogia é
> o mesmo erro que me fez reportar um defeito inexistente antes nesta sessão.
>
> O tipo também expõe `headers?` — é por onde o bearer por inquilino entra quando a auth
> estiver ligada (`initialize` sem ele devolve `401`, verificado).

## Como levantar o ouvinte do nosso lado

```bash
# 1. a API (o MCP é um proxy sobre ela)
THEOSKILL_PG_URI=postgres://theoskill:theoskill@127.0.0.1:5432/theoskill PORT=18740 \
  node packages/api/dist/server.js

# 2. o ouvinte MCP
THEOSKILL_REGISTRY=http://127.0.0.1:18740 PORT=18097 \
  node packages/mcp/dist/bin.js --transport streamable-http
# → theo-skills mcp: ouvindo em http://127.0.0.1:18097 → http://127.0.0.1:18740
```

## Autenticação — o que muda com ela ligada

Verificado em 2026-08-03: `initialize` **sem bearer devolve `401`**. O isolamento é **por sessão**
— o `RegistryPort` é ligado a partir da chave que o gateway cunha por inquilino, e registry
compartilhado faria o inquilino B ler o catálogo de A, com sintoma de "resultado plausível", não
de erro.

Para uso local sem gateway, a instância acima roda sem `THEOSKILL_AUTH` — **de propósito**: uma
credencial fixa no ambiente prenderia todas as sessões num inquilino só.

## O que as quatro ferramentas expõem

`search_skills` · `get_skill` · `load_skill` · `list_skill_revisions` — todas de **leitura**. Há
um teste de contrato (`packages/mcp/tests/contract/write-tool-guard.contract.test.ts`) que falha
no commit que adicionar a primeira ferramenta de escrita, porque esta camada **não verifica
escopo** — quem o aplica é a API REST, por rota.

## Por que este arquivo existe

O M28 afirma que a ponte remota *"não existe, e a razão é estrutural — não é configuração
faltando"*. Medido em 2026-08-03, é o contrário: as duas pontas existem e nunca foram ligadas.
Nossa metade está no ar; a outra precisa das quatro linhas acima.
