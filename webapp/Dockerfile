# syntax=docker/dockerfile:1

# -------- Deps (install using workspace lockfile)
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy ONLY the webapp manifest into its own folder (do not overwrite /app/package.json)
COPY webapp/package.json ./webapp/package.json

# Install just what webapp needs, per lockfile
RUN pnpm -w --filter webapp... install --frozen-lockfile


# -------- Build
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Bring node_modules and workspace files from deps
COPY --from=deps /app /app

# Now bring the rest of the webapp sources
COPY webapp ./webapp

# Build and prune to production deps
RUN pnpm -C webapp build && pnpm -C webapp prune --prod


# -------- Runtime
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Only copy what is needed to run
COPY --from=build /app/webapp/.next ./.next
COPY --from=build /app/webapp/public ./public
COPY --from=build /app/webapp/package.json ./package.json
COPY --from=build /app/webapp/node_modules ./node_modules

EXPOSE 3000
CMD ["pnpm","start"]