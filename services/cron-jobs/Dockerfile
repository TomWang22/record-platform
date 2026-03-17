# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy entire monorepo before install so pnpm can create workspace symlinks (@common/utils, etc.)
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app

# Build this service and its deps; then prune for prod
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter cron-jobs... build \
 && pnpm -C services/cron-jobs prune --prod --config.confirmModulesPurge=false

# Produce isolated deploy bundle (production deps only). Use same store mount so deploy copies from cache — no network.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter cron-jobs --prod /app/deploy

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user for security (before COPY so chown works)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy only production bundle (smaller image)
COPY --from=build --chown=nodejs:nodejs /app/deploy/ ./

# Remove unnecessary files
RUN rm -rf node_modules/.cache \
    && find . -name "*.map" -delete 2>/dev/null || true

USER nodejs

# cron-jobs uses jobs.js, not server.js (see package.json)
CMD ["node","dist/jobs.js"]
