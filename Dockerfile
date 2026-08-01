# Runtime da API + worker de LRO.
#
# TRÊS estágios, não dois — e o terceiro existe por uma razão medida, não por elegância.
#
# O MAJOR DO NODE AQUI E O DO `ci.yml` SÃO O MESMO, travado por
# `tests/workflows/gates.test.ts`: testar num major diferente do que se publica é como um
# worker morto chegar ao host de dev com a esteira verde.

# ── build ────────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# O pnpm pede confirmação interativa antes de purgar `node_modules` e aborta sem TTY
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY) — exatamente o caso de um `docker build`.
# `CI=true` é a via documentada pelo próprio pnpm para ambiente não-interativo.
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/cli/package.json ./packages/cli/
RUN corepack enable && corepack prepare --activate

# `--ignore-scripts` NÃO é contorno do ERR_PNPM_IGNORED_BUILDS — é a postura correta para
# build de container: nenhum script de dependência executa aqui. Verificado antes de decidir:
# o único pacote que pede script é o `esbuild`, 100% transitivo (vitest/tsx/eslint), e ele
# distribui o binário em pacotes de plataforma; o `postinstall` apenas valida.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig*.json ./
COPY packages ./packages
RUN pnpm run build

# ── deps de produção, em árvore SEPARADA ─────────────────────────────────────────────────
#
# O DEFEITO QUE ESTE ESTÁGIO CORRIGE (Trivy, run 30572922060 — 47 achados CRITICAL/HIGH):
# antes, o mesmo `node_modules` era instalado completo e depois "podado" com
# `pnpm install --prod` no MESMO diretório. A poda não limpa o store `.pnpm/`: a imagem final
# saía com TRÊS cópias do esbuild (0.18.20, 0.25.12, 0.28.1), mais postcss, js-yaml, picomatch
# e tar — nenhum deles alcançável em runtime, todos contando como superfície de ataque.
#
# 44 dos 47 achados vinham daí. Instalar produção numa árvore que NUNCA teve devDependencies
# elimina a classe inteira, em vez de remediar CVE por CVE. Mesmo desenho do estágio
# `production-deps` do theo-memory.
FROM node:22-slim AS production-deps
WORKDIR /app
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/cli/package.json ./packages/cli/
# O pacote MCP entra na imagem porque o MESMO artefato serve os dois processos: a API
# (CMD padrão) e o ouvinte MCP que o gateway fronta (`--transport streamable-http`, via
# `command:` no compose). Duas imagens para um repositório fariam as duas divergirem no
# primeiro build em que só uma fosse reconstruída — e a divergência apareceria como
# comportamento diferente entre superfícies do mesmo commit.
COPY packages/mcp/package.json ./packages/mcp/
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── runtime ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Usuário não-root: o `node` já existe na imagem oficial (uid 1000). Rodar como root é
# escalonamento gratuito para qualquer RCE na dependência mais obscura da árvore.
USER node

# As deps vêm do estágio que nunca viu devDependencies; o código, do que compilou.
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/api/dist ./packages/api/dist
COPY --from=build --chown=node:node /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 8080

# `/v1/health` é a rota registrada por `registerHealthRoutes` (api/src/server/handlers/health.ts).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/api/dist/server.js"]
