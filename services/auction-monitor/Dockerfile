# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common/package.json ./services/common/package.json
COPY services/auction-monitor/package.json ./services/auction-monitor/package.json

# Use BuildKit cache mounts for pnpm store (persists between builds)
# Also cache Puppeteer Chrome downloads to avoid 10+ minute downloads
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    --mount=type=cache,id=puppeteer-cache,target=/root/.cache/puppeteer \
    pnpm -w \
      --filter @common/utils... \
      --filter auction-monitor... \
      install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy installed dependencies from deps stage
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
COPY services/common ./services/common
COPY services/auction-monitor ./services/auction-monitor
COPY proto ./proto

# Build with cache mount for faster subsequent builds
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -w --filter @common/utils build \
 && pnpm -C services/auction-monitor build \
 && pnpm -C services/auction-monitor prune --prod \
 && pnpm -C services/auction-monitor install --prod --ignore-scripts --shamefully-hoist

# Verify express is installed before proceeding
RUN test -f services/auction-monitor/node_modules/express/package.json || (echo "ERROR: express not found after prune" && ls -la services/auction-monitor/node_modules/ | head -20 && exit 1)

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

# Copy built files and node_modules (workspace and service)
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/auction-monitor/dist ./dist
COPY --from=build /app/services/auction-monitor/package.json ./package.json
COPY --from=build /app/services/auction-monitor/node_modules ./node_modules
# Provide @common/utils target where pnpm symlink expects it
COPY --from=build /app/services/common /app/common
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

# Provide the .pnpm store at /node_modules/.pnpm so pnpm symlinks resolve
RUN mkdir -p /node_modules && cp -a /app/node_modules/.pnpm /node_modules/.pnpm

# Ensure @common/utils is resolvable by Node (flatten symlink to built dist)
RUN mkdir -p /app/node_modules/@common && ln -sf /app/common/dist /app/node_modules/@common/utils

CMD ["node","dist/start.js"]
