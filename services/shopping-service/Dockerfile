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

# Build this service and its deps (topological order: common then shopping-service)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter shopping-service... build

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/services/shopping-service

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
    apk del curl && rm -rf /var/cache/apk/*

# Copy node_modules from build stage (includes workspace symlinks from full monorepo install)
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/common /app/services/common

# Copy shopping-service files
COPY --from=build /app/services/shopping-service/node_modules ./node_modules
COPY --from=build /app/services/shopping-service/dist ./dist
COPY --from=build /app/services/shopping-service/package.json ./package.json

# Copy Lua scripts to dist/lib
RUN mkdir -p ./dist/lib
COPY --from=build /app/services/shopping-service/src/lib/lfu_lru_cache.lua ./dist/lib/

# Copy proto files
COPY --from=build /app/proto /app/proto

CMD ["node","dist/server.js"]

