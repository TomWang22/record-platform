# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
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

# grpc-health-probe: vendored binaries (no network in runtime stage)
COPY scripts/vendor/grpc_health_probe-linux-* /tmp/grpc-vendor/
RUN ARCH=$(dpkg --print-architecture) && if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi \
 && cp /tmp/grpc-vendor/grpc_health_probe-linux-${ARCH} /usr/local/bin/grpc-health-probe \
 && chmod +x /usr/local/bin/grpc-health-probe \
 && /usr/local/bin/grpc-health-probe -version

# OpenSSL for Prisma at runtime
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

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
