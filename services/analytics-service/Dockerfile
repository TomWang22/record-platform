# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Copy full workspace source for common + this service so pnpm install creates correct symlinks (no overwrite later)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/analytics-service ./services/analytics-service

# Install with workspace intact so @common/utils symlinks point at services/common
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    rp-pnpm -w --filter @common/utils... --filter analytics-service... install --frozen-lockfile --ignore-scripts

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
 && rp-pnpm -C services/analytics-service prune --prod --config.confirmModulesPurge=false

# Produce isolated deploy bundle (production deps only). Use same store mount so deploy copies from cache — no network.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm deploy --legacy --filter analytics-service --prod /app/deploy

# ---------- runtime ----------
FROM node:22-alpine
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="analytics-service"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
ENV NODE_ENV=production
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm

# Install grpc-health-probe for Kubernetes gRPC health checks (HTTP/2/3, NOT HTTP/1.1)
RUN apk add --no-cache curl ca-certificates file && \
    GRPC_HEALTH_PROBE_VERSION=v0.4.24 && \
    ARCH=$(apk --print-arch) && \
    if [ "$ARCH" = "x86_64" ]; then \
      BINARY_ARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then \
      BINARY_ARCH="arm64"; \
    else \
      echo "Unsupported architecture: $ARCH"; exit 1; \
    fi && \
    echo "Downloading grpc-health-probe ${GRPC_HEALTH_PROBE_VERSION} for ${BINARY_ARCH}..." && \
    curl -Lf -o /tmp/grpc-health-probe \
    https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-${BINARY_ARCH} && \
    echo "Verifying binary..." && \
    file /tmp/grpc-health-probe | grep -q "ELF.*executable" || (echo "ERROR: Downloaded file is not a valid ELF executable" && exit 1) && \
    chmod +x /tmp/grpc-health-probe && \
    /tmp/grpc-health-probe -version >/dev/null 2>&1 || (echo "ERROR: grpc-health-probe binary is corrupted or invalid" && exit 1) && \
    mv /tmp/grpc-health-probe /usr/local/bin/grpc-health-probe && \
    echo "Verifying installed binary..." && \
    /usr/local/bin/grpc-health-probe -version >/dev/null 2>&1 && \
    ls -lh /usr/local/bin/grpc-health-probe && \
    echo "✅ grpc-health-probe installed and verified successfully" && \
    apk del curl file && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy only production bundle (smaller image)
COPY --from=build --chown=nodejs:nodejs /app/deploy/ ./

# Remove unnecessary files
RUN rm -rf node_modules/.cache \
    && find . -name "*.map" -delete 2>/dev/null || true \
    && find . -name "*.ts" -type f -not -path "./node_modules/*" -delete 2>/dev/null || true

USER nodejs

EXPOSE 4017 50067
CMD ["node","dist/server.js"]
