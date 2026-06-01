# --- deps ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NPM_CONFIG_CONFIRM_MODULES_PURGE=false
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Copy full workspace source for common + auth-service + proto so pnpm install sees real tree
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/auth-service ./services/auth-service
COPY proto ./proto

# Install with workspace intact so @common/utils symlinks point at services/common
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    rp-pnpm -w --filter @common/utils... --filter auth-service... install --frozen-lockfile --ignore-scripts

# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NPM_CONFIG_CONFIRM_MODULES_PURGE=false
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Use deps stage as-is: do not COPY services/* again or symlinks break
COPY --from=deps /app /app

# Build common first so @common/utils dist/ exists before any service tsc runs (CI-safe)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -C services/common build

# Let workspace orchestrate build (topological order)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -w build

# --- runtime ---
FROM node:22-bookworm-slim
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="auth-service"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
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

EXPOSE 4001 50061
CMD ["node", "dist/server.js"]
