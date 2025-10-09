# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/auction-monitor/package.json ./services/auction-monitor/package.json

RUN pnpm -w \
  --filter @common/utils... \
  --filter auction-monitor... \
  install --frozen-lockfile --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/auction-monitor ./services/auction-monitor

RUN pnpm -C services/common build \
 && pnpm -C services/auction-monitor build \
 && pnpm -C services/auction-monitor prune --prod

FROM node:20-alpine
# keep workspace layout so pnpm's symlinks continue to resolve
WORKDIR /app/services/auction-monitor
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=build /app/services/auction-monitor/dist ./dist
COPY --from=build /app/services/auction-monitor/package.json ./package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/auction-monitor/node_modules ./node_modules
COPY --from=build /app/services/common /app/services/common

CMD ["pnpm","start"]
