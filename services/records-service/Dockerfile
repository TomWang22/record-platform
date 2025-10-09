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
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app

COPY services/common ./services/common
COPY services/records-service ./services/records-service

RUN pnpm -C services/common build \
 && pnpm -C services/records-service exec prisma generate \
 && pnpm -C services/records-service build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/records-service
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm store (workspace root)
COPY --from=build /app/node_modules /app/node_modules
# the service's node_modules
COPY --from=build /app/services/records-service/node_modules ./node_modules

# app bits
COPY --from=build /app/services/records-service/dist ./dist
COPY --from=build /app/services/records-service/package.json ./package.json
COPY --from=build /app/services/records-service/prisma ./prisma
COPY --from=build /app/services/records-service/generated ./generated
COPY --from=build /app/services/common /app/services/common

EXPOSE 4002
CMD ["node", "dist/server.js"]
