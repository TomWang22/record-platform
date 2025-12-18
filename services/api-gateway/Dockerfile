# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/api-gateway/package.json ./services/api-gateway/package.json

# Use BuildKit cache mounts for pnpm store (persists between builds)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w \
      --filter @common/utils... \
      --filter api-gateway... \
      install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy installed dependencies from deps stage
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
COPY services/common ./services/common
COPY services/api-gateway ./services/api-gateway
COPY proto ./proto

# Build with cache mount for faster subsequent builds
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build \
 && pnpm -C services/api-gateway build \
 && pnpm -C services/api-gateway prune --prod

# Produce isolated deploy bundle (production deps only)
RUN pnpm deploy --filter api-gateway --prod /app/deploy

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
