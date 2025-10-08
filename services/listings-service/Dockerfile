# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
# package manifests needed for filtered install
COPY services/common/package.json ./services/common/package.json
COPY services/listings-service/package.json ./services/listings-service/package.json

# install dev deps for BOTH common and listings (no scripts yet)
RUN pnpm -w \
  --filter @common/utils... \
  --filter listings-service... \
  install --frozen-lockfile --ignore-scripts


FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# bring node_modules from deps
COPY --from=deps /app /app

# now copy sources
COPY services/common ./services/common
COPY services/listings-service ./services/listings-service

# build common first, then the service; then drop dev deps for runtime
RUN pnpm -C services/common build \
 && pnpm -C services/listings-service build \
 && pnpm -C services/listings-service prune --prod


FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# runtime bits
COPY --from=build /app/services/listings-service/dist ./dist
COPY --from=build /app/services/listings-service/package.json ./package.json
COPY --from=build /app/services/listings-service/node_modules ./node_modules

# keep built common so workspace symlink resolves at runtime
COPY --from=build /app/services/common ./services/common

CMD ["node","dist/server.js"]
