# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Only the manifests we care about
COPY services/common/package.json ./services/common/package.json
COPY services/records-service/package.json ./services/records-service/package.json

# Install JUST common + this service (with dev deps so tsc/prisma are present)
RUN pnpm -w \
  --filter @common/utils... \
  --filter records-service... \
  install --frozen-lockfile --ignore-scripts


FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Bring installed node_modules
COPY --from=deps /app /app

# Copy sources needed to build
COPY services/common ./services/common
COPY services/records-service ./services/records-service

# Build common first, then this service; then prune to prod
RUN pnpm -C services/common build \
 && pnpm -C services/records-service build \
 && pnpm -C services/records-service prune --prod


FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy built service
COPY --from=build /app/services/records-service/dist ./dist
COPY --from=build /app/services/records-service/package.json ./package.json
COPY --from=build /app/services/records-service/node_modules ./node_modules

# Important: include the built common workspace so pnpm workspace link resolves
COPY --from=build /app/services/common ./services/common

# prisma schema if you need it at runtime (harmless otherwise)
COPY --from=build /app/services/records-service/prisma ./prisma
EXPOSE 4002
CMD ["pnpm","start"]
