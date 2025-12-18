# syntax=docker/dockerfile:1

# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/social-service/package.json ./services/social-service/package.json
COPY services/common/src ./services/common/src

# Use BuildKit cache mounts for pnpm store (persists between builds)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w \
      --filter @common/utils... \
      --filter social-service... \
      install --frozen-lockfile

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install OpenSSL for Prisma (with apt cache mount for faster installs)
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt \
    apt-get update --allow-insecure-repositories || true && \
    apt-get install -y --allow-unauthenticated --no-install-recommends curl ca-certificates openssl || \
    (echo "OpenSSL may already be installed, continuing..." && which openssl || true) && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
COPY services/common ./services/common
COPY services/social-service ./services/social-service
COPY proto ./proto

# Build with cache mount for faster subsequent builds
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build \
 && rm -rf services/social-service/generated \
 && pnpm -C services/social-service exec prisma generate --schema prisma/schema.prisma \
 && pnpm -C services/social-service build \
 && mkdir -p services/social-service/dist/lib \
 && cp services/social-service/src/lib/*.lua services/social-service/dist/lib/ \
 && test -f services/social-service/dist/lib/singleflight_cache.lua

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/social-service
ENV NODE_ENV=production

# Install grpc-health-probe (fail fast; no apt cache mounts to avoid corruption)
RUN set -eux; \
    rm -rf /var/lib/apt/lists/*; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates file; \
    GRPC_HEALTH_PROBE_VERSION=v0.4.24; \
    ARCH="$(dpkg --print-architecture)"; \
    if [ "$ARCH" = "amd64" ]; then BINARY_ARCH="amd64"; \
    elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then BINARY_ARCH="arm64"; \
    else echo "Unsupported architecture: $ARCH"; exit 1; fi; \
    curl -Lf -o /usr/local/bin/grpc-health-probe \
      "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-${BINARY_ARCH}"; \
    file /usr/local/bin/grpc-health-probe | grep -q 'ELF'; \
    chmod +x /usr/local/bin/grpc-health-probe; \
    /usr/local/bin/grpc-health-probe -version >/dev/null 2>&1; \
    apt-get purge -y curl file; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/social-service/node_modules ./node_modules
COPY --from=build /app/services/social-service/dist ./dist
COPY --from=build /app/services/social-service/src/lib/*.lua ./dist/lib/
## (safety) ensure lua exists in runtime image
RUN test -f dist/lib/singleflight_cache.lua
COPY --from=build /app/services/social-service/package.json ./package.json
COPY --from=build /app/services/social-service/prisma ./prisma
COPY --from=build /app/services/social-service/generated ./generated
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4006 50056
CMD ["node", "dist/server.js"]

