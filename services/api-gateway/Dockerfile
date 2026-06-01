# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Copy full workspace source for common + this service + proto so pnpm install sees real tree
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/api-gateway ./services/api-gateway
COPY proto ./proto

# Install with workspace intact so @common/utils symlinks point at services/common
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    rp-pnpm -w --filter @common/utils... --filter api-gateway... install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Use deps stage as-is: do not COPY services/* again or symlinks break
COPY --from=deps /app /app

# Build common first so @common/utils dist/ exists before any service tsc runs (CI-safe)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -C services/common build

# Let workspace orchestrate build (topological order); then prune this service for prod
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -w build \
 && rp-pnpm -C services/api-gateway prune --prod --config.confirmModulesPurge=false

# Produce isolated deploy bundle (production deps only). Use same store mount so deploy copies from cache — no network.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm deploy --legacy --filter api-gateway --prod /app/deploy

# ---------- runtime ----------
FROM node:22-alpine
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="api-gateway"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
ENV NODE_ENV=production
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm

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
