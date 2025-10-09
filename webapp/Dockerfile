# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY webapp/package.json ./webapp/package.json
RUN pnpm -w --filter webapp... install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app
COPY webapp ./webapp

# 👇 ensure this exists even if your repo has no public/
RUN mkdir -p webapp/public

RUN pnpm -C webapp build && pnpm -C webapp prune --prod

FROM node:20-alpine
# keep workspace layout so pnpm's symlinks continue to resolve
WORKDIR /app/webapp
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy runtime bits (non-standalone layout)
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/webapp/.next ./.next
COPY --from=build /app/webapp/node_modules ./node_modules
COPY --from=build /app/webapp/package.json ./package.json
COPY --from=build /app/webapp/public ./public

EXPOSE 3000
# Don’t rely on pnpm at runtime; call Next CLI via node:
CMD ["node","./node_modules/next/dist/bin/next","start","-p","3001"]
