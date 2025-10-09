# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# workspace manifests (+ base tsconfig!)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
# only the manifests we need for filtered install
COPY services/common/package.json ./services/common/package.json
COPY services/api-gateway/package.json ./services/api-gateway/package.json

# install dev deps for BOTH common and gateway; no scripts yet
RUN pnpm -w \
  --filter @common/utils... \
  --filter api-gateway... \
  install --frozen-lockfile --ignore-scripts


FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# bring installed node_modules and tsconfig.base.json
COPY --from=deps /app /app

# now copy sources
COPY services/common ./services/common
COPY services/api-gateway ./services/api-gateway

# build common first, then gateway; then prune dev deps for runtime
RUN pnpm -C services/common build \
 && pnpm -C services/api-gateway build \
 && pnpm -C services/api-gateway prune --prod


FROM node:20-alpine
# keep workspace layout so pnpm's symlinks continue to resolve
WORKDIR /app/services/api-gateway
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# runtime bits
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/api-gateway/dist ./dist
COPY --from=build /app/services/api-gateway/package.json ./package.json
COPY --from=build /app/services/api-gateway/node_modules ./node_modules

# include built common to satisfy pnpm workspace link at runtime
COPY --from=build /app/services/common /app/services/common

CMD ["node","dist/server.js"]
