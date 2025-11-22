# syntax=docker/dockerfile:1

# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/social-service/package.json ./services/social-service/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/common/src ./services/common/src

RUN pnpm -w \
  --filter @common/utils... \
  --filter social-service... \
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

# Bring in full sources
COPY services/common ./services/common
COPY services/social-service ./services/social-service
COPY proto ./proto

# Build shared, generate prisma client, build service
RUN pnpm -C services/common build \
 && rm -rf services/social-service/generated \
 && pnpm -C services/social-service exec prisma generate --schema prisma/schema.prisma \
 && pnpm -C services/social-service build \
 && mkdir -p services/social-service/dist/lib \
 && cp services/social-service/src/lib/*.lua services/social-service/dist/lib/ \
 && test -f services/social-service/dist/lib/singleflight_cache.lua

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/social-service
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/social-service/node_modules ./node_modules
COPY --from=build /app/services/social-service/dist ./dist
COPY --from=build /app/services/social-service/src/lib/*.lua ./dist/lib/
## (safety) ensure lua exists in runtime image
RUN test -f dist/lib/singleflight_cache.lua
COPY --from=build /app/services/social-service/package.json ./package.json
COPY --from=build /app/services/social-service/prisma ./prisma
COPY --from=build /app/services/social-service/generated ./generated
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4006 50056
CMD ["node", "dist/server.js"]

