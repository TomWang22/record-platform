# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# only the manifests of deps we care about (common + this svc)
COPY services/common/package.json ./services/common/package.json
COPY services/analytics-service/package.json ./services/analytics-service/package.json

# install ONLY what we need for this build; no scripts yet
RUN pnpm -w \
  --filter @common/utils... \
  --filter analytics-service... \
  install --frozen-lockfile --ignore-scripts


FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# bring installed node_modules
COPY --from=deps /app /app

# now copy the sources we actually need
COPY services/common ./services/common
COPY services/analytics-service ./services/analytics-service

# build common first, then the service (runs prisma generate + tsc)
RUN pnpm -C services/common build \
 && pnpm -C services/analytics-service build \
 && pnpm -C services/analytics-service prune --prod


FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# copy built service + its node_modules
COPY --from=build /app/services/analytics-service/dist ./dist
COPY --from=build /app/services/analytics-service/package.json ./package.json
COPY --from=build /app/services/analytics-service/node_modules ./node_modules

# IMPORTANT: pnpm links @common/utils as a workspace symlink;
# include the built common project so the link resolves at runtime.
COPY --from=build /app/services/common ./services/common

# prisma schema if you need it at runtime (harmless otherwise)
COPY --from=build /app/services/analytics-service/prisma ./prisma

EXPOSE 4004
CMD ["pnpm","start"]
