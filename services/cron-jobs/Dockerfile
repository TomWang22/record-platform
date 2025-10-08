# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/cron-jobs/package.json ./services/cron-jobs/package.json

RUN pnpm -w \
  --filter @common/utils... \
  --filter cron-jobs... \
  install --frozen-lockfile --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/cron-jobs ./services/cron-jobs

RUN pnpm -C services/common build \
 && pnpm -C services/cron-jobs build \
 && pnpm -C services/cron-jobs prune --prod

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=build /app/services/cron-jobs/dist ./dist
COPY --from=build /app/services/cron-jobs/package.json ./package.json
COPY --from=build /app/services/cron-jobs/node_modules ./node_modules
COPY --from=build /app/services/common ./services/common

CMD ["pnpm","start"]
