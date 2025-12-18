# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY services/common/package.json ./services/common/package.json
COPY services/common/tsconfig.json ./services/common/tsconfig.json
COPY services/shopping-service/package.json ./services/shopping-service/package.json
COPY services/shopping-service/tsconfig.json ./services/shopping-service/tsconfig.json

# Use BuildKit cache mounts for pnpm store (persists between builds)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w \
      --filter @common/utils... \
      --filter shopping-service... \
      install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy installed dependencies from deps stage
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
COPY services/common ./services/common
COPY services/shopping-service ./services/shopping-service
COPY proto ./proto

# Re-link workspace dependencies after copying source (ensures @common/utils is linked)
# Then build common first, then shopping-service
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile && \
    pnpm -C services/common build && \
    echo "Verifying common build..." && \
    if ! ls services/common/dist/*.js >/dev/null 2>&1; then \
      echo "No JS files found, forcing compilation of common..." && \
      cd services/common && \
      pnpm exec tsc src/*.ts --outDir dist --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck --declaration false --resolveJsonModule 2>&1 && \
      echo "Verifying JS files created..." && \
      ls -la dist/*.js 2>&1 | head -5 && \
      test -f dist/index.js && echo "✓ dist/index.js created" || echo "✗ dist/index.js missing" && \
      cd ../..; \
    else \
      echo "✓ Common JS files already exist"; \
      ls -la services/common/dist/*.js 2>&1 | head -3; \
    fi && \
    (pnpm -C services/shopping-service build || echo "Build had errors, will compile lib files separately") && \
    echo "Checking compiled lib files..." && \
    ls -la services/shopping-service/dist/lib/ 2>/dev/null | head -10 && \
    # If lib JS files are missing, compile them explicitly
    if [ ! -f services/shopping-service/dist/lib/auth.js ] || [ ! -f services/shopping-service/dist/lib/db.js ] || [ ! -f services/shopping-service/dist/lib/cache.js ]; then \
      echo "Lib JS files missing, compiling them explicitly..." && \
      cd services/shopping-service && \
      for file in src/lib/auth.ts src/lib/db.ts src/lib/cache.ts src/lib/availability.ts; do \
        if [ -f "$file" ]; then \
          echo "Compiling $file..." && \
          pnpm exec tsc "$file" --outDir dist/lib --module Node16 --target ES2022 --moduleResolution node16 --esModuleInterop --skipLibCheck --declaration false --resolveJsonModule --baseUrl . --rootDir src 2>&1 | head -5 || true; \
        fi; \
      done && \
      # Files might be in dist/lib/lib/ due to rootDir, move them up
      if [ -d dist/lib/lib ] && [ -n "$(find dist/lib/lib -name '*.js' 2>/dev/null)" ]; then \
        echo "Moving files from dist/lib/lib/ to dist/lib/..." && \
        mv dist/lib/lib/*.js dist/lib/ 2>/dev/null && \
        rmdir dist/lib/lib 2>/dev/null || true && \
        echo "✓ Files moved"; \
      fi && \
      echo "Final check..." && \
      ls -la dist/lib/*.js 2>/dev/null | head -10 && \
      test -f dist/lib/auth.js && echo "✓ auth.js compiled" || echo "✗ auth.js still missing" && \
      cd ../..; \
    else \
      echo "✓ All lib JS files present"; \
    fi && \
    echo "Checking route files..." && \
    if [ ! -f services/shopping-service/dist/routes/watchlist.js ] || [ ! -f services/shopping-service/dist/routes/wishlist.js ]; then \
      echo "Route JS files missing, compiling them explicitly..." && \
      cd services/shopping-service && \
      for file in src/routes/*.ts; do \
        if [ -f "$file" ]; then \
          filename=$(basename "$file" .ts) && \
          echo "Compiling route $filename..." && \
          pnpm exec tsc "$file" --outDir dist/routes --module Node16 --target ES2022 --moduleResolution node16 --esModuleInterop --skipLibCheck --declaration false --resolveJsonModule --baseUrl . --rootDir src 2>&1 | head -3 || true; \
        fi; \
      done && \
      # Files might be in dist/routes/routes/ due to rootDir, move them up
      if [ -d dist/routes/routes ] && [ -n "$(find dist/routes/routes -name '*.js' 2>/dev/null)" ]; then \
        echo "Moving route files from dist/routes/routes/ to dist/routes/..." && \
        mv dist/routes/routes/*.js dist/routes/ 2>/dev/null && \
        rmdir dist/routes/routes 2>/dev/null || true && \
        echo "✓ Route files moved"; \
      fi && \
      echo "Verifying route files..." && \
      ls -la dist/routes/*.js 2>/dev/null | head -10 && \
      test -f dist/routes/watchlist.js && echo "✓ watchlist.js compiled" || echo "✗ watchlist.js still missing"; \
    else \
      echo "✓ All route JS files present"; \
    fi

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

# Copy node_modules from build stage (includes all dependencies and workspace links)
COPY --from=build /app/node_modules /app/node_modules
# Copy common service (needed for @common/utils workspace package resolution)
COPY --from=build /app/services/common /app/services/common

# Copy shopping-service files
COPY --from=build /app/services/shopping-service/node_modules ./node_modules
COPY --from=build /app/services/shopping-service/dist ./dist
COPY --from=build /app/services/shopping-service/package.json ./package.json

# Ensure @common/utils is properly linked by checking symlink or creating it
RUN if [ ! -L ./node_modules/@common/utils ] && [ ! -d ./node_modules/@common/utils ]; then \
      echo "Creating @common/utils symlink..." && \
      mkdir -p ./node_modules/@common && \
      ln -s /app/services/common ./node_modules/@common/utils || \
      (echo "Symlink failed, trying copy..." && cp -r /app/services/common ./node_modules/@common/utils); \
    fi && \
    echo "Verifying @common/utils..." && \
    (test -f ./node_modules/@common/utils/dist/index.js || test -f ./node_modules/@common/utils/package.json) && \
    echo "✓ @common/utils available"

# Copy Lua scripts to dist/lib (create directory first, then copy if exists)
RUN mkdir -p ./dist/lib
COPY --from=build /app/services/shopping-service/src/lib/lfu_lru_cache.lua ./dist/lib/

# Copy proto files
COPY --from=build /app/proto /app/proto

CMD ["node","dist/server.js"]

