# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy full workspace source for common + this service so pnpm install sees real tree
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/listings-service ./services/listings-service

# Install with workspace intact so @common/utils symlinks point at services/common
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter @common/utils... --filter listings-service... install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Use deps stage as-is: do not COPY services/* again or symlinks break
COPY --from=deps /app /app

# Build in dependency order so common/dist exists before service tsc runs
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @common/utils run build \
 && pnpm -C services/listings-service run build

# Produce isolated deploy bundle (production deps only). Use same store mount so deploy copies from cache — no network.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter listings-service --prod /app/deploy

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

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

# Copy only production bundle (smaller image)
COPY --from=build /app/deploy/ ./

CMD ["node","dist/server.js"]