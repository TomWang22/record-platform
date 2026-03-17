# Uses node:20-alpine (same as api-gateway, listings-service, etc.) so base image is likely cached.
# No syntax= line to avoid Docker Hub pull; no dependency on docker.io for build.
# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy entire monorepo before install so pnpm can create workspace symlinks (@common/utils, etc.)
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile

# --- build ---
FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app

# Build this service and its deps; then copy Lua scripts (not in package.json build)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rm -rf services/social-service/generated \
 && pnpm --filter social-service... build \
 && mkdir -p services/social-service/dist/lib \
 && cp services/social-service/src/lib/*.lua services/social-service/dist/lib/ \
 && test -f services/social-service/dist/lib/singleflight_cache.lua

# --- runtime ---
# gRPC + strict TLS/mTLS: use grpc-health-probe for health (vendored, no network in build).
FROM node:20-alpine
WORKDIR /app/services/social-service
ENV NODE_ENV=production

# grpc-health-probe: vendored binaries (same as records-service)
COPY scripts/vendor/grpc_health_probe-linux-* /tmp/grpc-vendor/
RUN set -e; \
  if [ "$(uname -m)" = "aarch64" ]; then \
    cp /tmp/grpc-vendor/grpc_health_probe-linux-arm64 /usr/local/bin/grpc-health-probe; \
  else \
    cp /tmp/grpc-vendor/grpc_health_probe-linux-amd64 /usr/local/bin/grpc-health-probe; \
  fi; \
  chmod +x /usr/local/bin/grpc-health-probe && /usr/local/bin/grpc-health-probe -version

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/social-service/node_modules ./node_modules
COPY --from=build /app/services/social-service/dist ./dist
COPY --from=build /app/services/social-service/src/lib/*.lua ./dist/lib/
RUN test -f dist/lib/singleflight_cache.lua
COPY --from=build /app/services/social-service/package.json ./package.json
COPY --from=build /app/services/social-service/prisma ./prisma
COPY --from=build /app/services/social-service/generated ./generated
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto ./proto

EXPOSE 4006 50056
CMD ["node", "dist/server.js"]
