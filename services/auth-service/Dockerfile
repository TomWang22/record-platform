# syntax=docker/dockerfile:1

# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/auth-service/package.json ./services/auth-service/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/common/src ./services/common/src
RUN pnpm -w --filter @common/utils... --filter auth-service... install --frozen-lockfile

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/auth-service ./services/auth-service
RUN pnpm -C services/common build \
 && rm -rf services/auth-service/prisma/generated \
 && pnpm -C services/auth-service exec prisma generate --schema prisma/schema.prisma \
 && pnpm -C services/auth-service build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/auth-service
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/auth-service/node_modules ./node_modules
COPY --from=build /app/services/auth-service/dist ./dist
COPY --from=build /app/services/auth-service/package.json ./package.json
# prisma dir includes generated client at ./prisma/generated/client
COPY --from=build /app/services/auth-service/prisma ./prisma
COPY --from=build /app/services/common /app/services/common

EXPOSE 4001
CMD ["node", "dist/server.js"]