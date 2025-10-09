# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/analytics-service/package.json ./services/analytics-service/package.json

RUN pnpm -w \
  --filter @common/utils... \
  --filter analytics-service... \
  install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/analytics-service ./services/analytics-service

RUN pnpm -C services/common build \
 && pnpm -C services/analytics-service build \
 && pnpm -C services/analytics-service prune --prod

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/services/analytics-service

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/analytics-service /app/services/analytics-service
COPY --from=build /app/services/common /app/services/common

EXPOSE 4004
CMD ["node","dist/server.js"]
