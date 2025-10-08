# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# ADD tsconfig.base.json HERE
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/auth-service/package.json ./services/auth-service/package.json

RUN pnpm -w \
  --filter @common/utils... \
  --filter auth-service... \
  install --frozen-lockfile --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/auth-service ./services/auth-service

RUN pnpm -C services/common build \
 && pnpm -C services/auth-service build \
 && pnpm -C services/auth-service prune --prod

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=build /app/services/auth-service/dist ./dist
COPY --from=build /app/services/auth-service/package.json ./package.json
COPY --from=build /app/services/auth-service/node_modules ./node_modules
COPY --from=build /app/services/common ./services/common

CMD ["pnpm","start"]
