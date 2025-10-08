# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/listings-service/package.json ./services/listings-service/package.json

RUN pnpm -w --filter ./services/listings-service... install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app
COPY services/common ./services/common
COPY services/listings-service ./services/listings-service

RUN pnpm -C services/common build && pnpm -C services/listings-service build
RUN pnpm -C services/listings-service prune --prod

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=build /app/services/listings-service/dist ./dist
COPY --from=build /app/services/listings-service/package.json ./package.json
COPY --from=build /app/services/listings-service/node_modules ./node_modules

CMD ["pnpm","start"]
