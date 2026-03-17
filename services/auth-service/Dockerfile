# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common/package.json ./services/common/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/auth-service/package.json ./services/auth-service/package.json
COPY services/common/src ./services/common/src

# Use BuildKit cache mounts for pnpm store (persists between builds)
# Skip scripts during deps stage to avoid prepare script trying to build without OpenTelemetry deps
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter @common/utils... --filter auth-service... install --frozen-lockfile --ignore-scripts

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
COPY services/common ./services/common
COPY services/auth-service ./services/auth-service
COPY proto ./proto

# Build workspace: pnpm builds deps (@common/utils) then auth-service (prisma generate + tsc) in topological order
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter auth-service... run build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/auth-service

# Vendored grpc-health-probe (run: curl -Lf -o scripts/vendor/grpc_health_probe-linux-arm64 https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.24/grpc_health_probe-linux-arm64)
COPY scripts/vendor/ /tmp/grpc-vendor/
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi && \
    if [ -f /tmp/grpc-vendor/grpc_health_probe-linux-${ARCH} ]; then \
      cp /tmp/grpc-vendor/grpc_health_probe-linux-${ARCH} /usr/local/bin/grpc-health-probe && chmod +x /usr/local/bin/grpc-health-probe && /usr/local/bin/grpc-health-probe -version && echo "✅ grpc-health-probe (vendored)"; \
    else \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates file && \
      BINARY_ARCH="$ARCH" && \
      curl -Lf -o /tmp/grpc-health-probe \
        https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.24/grpc_health_probe-linux-${BINARY_ARCH} && \
      file /tmp/grpc-health-probe | grep -q "ELF.*executable" && chmod +x /tmp/grpc-health-probe && mv /tmp/grpc-health-probe /usr/local/bin/grpc-health-probe && \
      apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* && echo "✅ grpc-health-probe (downloaded)"; \
    fi

ENV NODE_ENV=production

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/auth-service/node_modules ./node_modules
COPY --from=build /app/services/auth-service/dist ./dist
COPY --from=build /app/services/auth-service/package.json ./package.json
# prisma dir includes generated client at ./prisma/generated/client
COPY --from=build /app/services/auth-service/prisma ./prisma
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4001
CMD ["node", "dist/server.js"]