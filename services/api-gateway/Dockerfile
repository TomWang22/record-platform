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

# Build this service and its deps (topological order: common then api-gateway)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter api-gateway... build \
 && pnpm -C services/api-gateway prune --prod --config.confirmModulesPurge=false

# Produce isolated deploy bundle (production deps only). Use same store mount so deploy copies from cache — no network.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter api-gateway --prod /app/deploy

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy only production bundle (smaller image)
COPY --from=build --chown=nodejs:nodejs /app/deploy/ ./
# Include proto files for gRPC client loading
COPY --from=build --chown=nodejs:nodejs /app/proto /app/proto

# Remove unnecessary files
RUN rm -rf node_modules/.cache \
    && find . -name "*.map" -delete 2>/dev/null || true \
    && find . -name "*.ts" -type f -not -path "./node_modules/*" -delete 2>/dev/null || true

USER nodejs

EXPOSE 4000
CMD ["node","dist/server.js"]
