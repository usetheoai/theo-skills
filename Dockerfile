# Runtime da API + worker de LRO.
#
# Multi-stage: o estágio de build carrega toolchain e devDependencies; o de runtime carrega
# só o que executa. Exigido pelo Theo Architecture Standard § 5.
#
# O MAJOR DO NODE AQUI E O DO `ci.yml` SÃO O MESMO, e isso é travado por
# `tests/workflows/gates.test.ts`: testar num major diferente do que se publica é como um
# worker morto chegar ao host de dev com a esteira verde.

# ── build ────────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# O pnpm pede confirmação interativa antes de purgar `node_modules` e aborta sem TTY
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY) — que é exatamente o caso de um `docker build`.
# `CI=true` é a via documentada pelo próprio pnpm para ambiente não-interativo.
ENV CI=true

# Habilita o pnpm da versão declarada em `packageManager` (corepack lê do package.json).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/cli/package.json ./packages/cli/
RUN corepack enable && corepack prepare --activate

# Camada de dependências separada da de código: alterar um `.ts` não invalida o install.
#
# `--ignore-scripts` NÃO é contorno do ERR_PNPM_IGNORED_BUILDS — é a postura correta para
# build de container: nenhum script de dependência executa aqui.
#
# Verificado antes de decidir: o único pacote que pede script é o `esbuild`, e ele é
# 100% TRANSITIVO (vitest / tsx / eslint). Nenhuma dependência de PRODUÇÃO precisa de
# script — o estágio de build só executa `tsc`, que não tem `postinstall`, e o estágio
# de runtime instala com `--prod`, sem as devDependencies. O binário nativo do esbuild
# seria baixado para nunca ser usado.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig*.json ./
COPY packages ./packages
RUN pnpm run build

# Reinstala apenas produção, descartando o toolchain de build do node_modules final.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── runtime ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Usuário não-root: o `node` já existe na imagem oficial (uid 1000). Rodar como root é
# escalonamento gratuito para qualquer RCE na dependência mais obscura da árvore.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 8080

# `/v1/health` é a rota registrada por `registerHealthRoutes` (api/src/server/handlers/health.ts).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/api/dist/server.js"]
