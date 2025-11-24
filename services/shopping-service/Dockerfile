# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# workspace manifests (needed for resolution)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
# package manifests for the pieces we care about
COPY services/common/package.json ./services/common/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/shopping-service/package.json ./services/shopping-service/package.json
COPY services/shopping-service/tsconfig.json ./services/shopping-service/tsconfig.json

# install without running scripts yet (we'll build in next stage)
RUN pnpm -w \
  --filter @common/utils... \
  --filter shopping-service... \
  install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# bring the prepared workspace
COPY --from=deps /app /app

# now add sources
COPY services/common ./services/common
COPY services/shopping-service ./services/shopping-service
COPY proto ./proto

# build lib then the service
RUN pnpm -C services/common build \
 && pnpm -C services/shopping-service build

# produce an isolated deploy bundle for just this service (includes node_modules)
RUN pnpm deploy --filter shopping-service --prod /app/deploy

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# package.json, dist/, node_modules/ for shopping-service only
COPY --from=build /app/deploy/ ./
# Copy Lua scripts
COPY --from=build /app/services/shopping-service/src/lib/*.lua ./dist/lib/

CMD ["node","dist/server.js"]

