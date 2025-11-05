# syntax=docker/dockerfile:1

# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/records-service/package.json ./services/records-service/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/common/src ./services/common/src

RUN pnpm -w \
  --filter @common/utils... \
  --filter records-service... \
  install --frozen-lockfile

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# OpenSSL for prisma generate
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app

# Bring in full sources (this COPY INVALIDATES CACHE when src changes)
COPY services/common ./services/common
COPY services/records-service ./services/records-service

# Build shared, generate prisma client, build service
RUN pnpm -C services/common build \
 && rm -rf services/records-service/generated/records-client \
 && pnpm -C services/records-service exec prisma generate --schema prisma/schema.prisma \
 && pnpm -C services/records-service build \
 && mkdir -p services/records-service/dist/lib \
 && cp services/records-service/src/lib/*.lua services/records-service/dist/lib/ \
 && test -f services/records-service/dist/routes/records.js \
 && grep -q "__" services/records-service/dist/routes/records.js || true

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/records-service
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/records-service/node_modules ./node_modules
COPY --from=build /app/services/records-service/dist ./dist
COPY --from=build /app/services/records-service/src/lib/*.lua ./dist/lib/
## (safety) ensure lua exists in runtime image
RUN test -f dist/lib/singleflight_cache.lua
COPY --from=build /app/services/records-service/package.json ./package.json
COPY --from=build /app/services/records-service/prisma ./prisma
COPY --from=build /app/services/records-service/generated ./generated
COPY --from=build /app/services/common /app/services/common

EXPOSE 4002
CMD ["node", "dist/server.js"]
