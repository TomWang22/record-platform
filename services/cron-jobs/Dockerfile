# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# any local workspace packages needed by cron-jobs (adjust if different)
COPY services/common/package.json ./services/common/package.json

# the service package.json
COPY services/cron-jobs/package.json ./services/cron-jobs/package.json

# install only what's needed for this service (dev deps included)
RUN pnpm -w --filter ./services/cron-jobs... install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
# now copy sources for the service (and any local libs it imports)
COPY services/common ./services/common
COPY services/cron-jobs ./services/cron-jobs

# build just this service
RUN pnpm -C services/common build && pnpm -C services/cron-jobs build

# prune to production deps for runtime
RUN pnpm -C services/cron-jobs prune --prod

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# copy built output + runtime deps
COPY --from=build /app/services/cron-jobs/dist ./dist
COPY --from=build /app/services/cron-jobs/package.json ./package.json
COPY --from=build /app/services/cron-jobs/node_modules ./node_modules

# start command (uses your package.json "start")
CMD ["pnpm","start"]
