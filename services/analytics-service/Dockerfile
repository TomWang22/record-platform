# syntax=docker/dockerfile:1
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

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/analytics-service ./services/analytics-service

RUN pnpm -C services/common build \
 && pnpm -C services/analytics-service build \
 && pnpm -C services/analytics-service prune --prod

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=build /app/services/analytics-service/dist ./dist
COPY --from=build /app/services/analytics-service/package.json ./package.json
COPY --from=build /app/services/analytics-service/node_modules ./node_modules
COPY --from=build /app/services/common ./services/common

CMD ["pnpm","start"]
