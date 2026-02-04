# syntax=docker/dockerfile:1

# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/records-service/package.json ./services/records-service/package.json
COPY services/common/src ./services/common/src

# Use BuildKit cache mounts for pnpm store (persists between builds)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w \
      --filter @common/utils... \
      --filter records-service... \
      install --frozen-lockfile

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install OpenSSL for Prisma (with apt cache mount for faster installs)
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt \
    (apt-get update --allow-releaseinfo-change 2>&1 | grep -v "GPG error" || true) \
 && (apt-get install -y --no-install-recommends --allow-unauthenticated curl ca-certificates openssl 2>&1 | grep -v "GPG error" || \
     (command -v openssl >/dev/null 2>&1 && echo "OpenSSL already available" || (apt-get update && apt-get install -y --no-install-recommends curl ca-certificates openssl))) \
 && rm -rf /var/lib/apt/lists/* || true

RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
COPY services/common ./services/common
COPY services/records-service ./services/records-service

# Build with cache mount for faster subsequent builds
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build \
 && rm -rf services/records-service/generated/records-client \
 && pnpm -C services/records-service exec prisma generate --schema prisma/schema.prisma \
 && pnpm -C services/records-service build \
 && mkdir -p services/records-service/dist/lib \
 && cp services/records-service/src/lib/*.lua services/records-service/dist/lib/ \
 && test -f services/records-service/dist/routes/records.js \
 && grep -q "__" services/records-service/dist/routes/records.js || true

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/records-service
ENV NODE_ENV=production

# Install grpc-health-probe for Kubernetes gRPC health checks (HTTP/2/3, NOT HTTP/1.1)
# Detect architecture and download appropriate binary with verification
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates openssl file && \
    GRPC_HEALTH_PROBE_VERSION=v0.4.24 && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      BINARY_ARCH="amd64"; \
    elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then \
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
    apt-get purge -y curl file && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/records-service/node_modules ./node_modules
COPY --from=build /app/services/records-service/dist ./dist
COPY --from=build /app/services/records-service/src/lib/*.lua ./dist/lib/
## (safety) ensure lua exists in runtime image
RUN test -f dist/lib/singleflight_cache.lua
COPY --from=build /app/services/records-service/package.json ./package.json
COPY --from=build /app/services/records-service/prisma ./prisma
COPY --from=build /app/services/records-service/generated ./generated
COPY --from=build /app/services/common /app/services/common

EXPOSE 4002
CMD ["node", "dist/server.js"]
