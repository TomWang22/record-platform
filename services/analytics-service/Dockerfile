# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Workspace manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
# Package manifests needed for a correct filtered install
COPY services/common/package.json ./services/common/package.json
COPY services/analytics-service/package.json ./services/analytics-service/package.json

# Install deps for analytics-service + its deps (common)
RUN pnpm -w --filter ./services/analytics-service^... install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Bring node_modules + manifests
COPY --from=deps /app /app

# Bring sources
COPY services/common ./services/common
COPY services/analytics-service ./services/analytics-service

# Build in topological order (common first)
RUN pnpm -r --filter ./services/analytics-service^... build

# Prune to production dependencies for runtime
RUN pnpm -C services/analytics-service prune --prod

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=build /app/services/analytics-service/dist ./dist
COPY --from=build /app/services/analytics-service/package.json ./package.json
COPY --from=build /app/services/analytics-service/node_modules ./node_modules

EXPOSE 4004
CMD ["pnpm","start"]