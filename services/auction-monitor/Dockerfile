# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
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
    pnpm -C services/common build \
 && pnpm -C services/auction-monitor build \
 && pnpm -C services/auction-monitor prune --prod \
 && pnpm -C services/auction-monitor install --prod --ignore-scripts --shamefully-hoist

# Verify express is installed before proceeding
RUN test -f services/auction-monitor/node_modules/express/package.json || (echo "ERROR: express not found after prune" && ls -la services/auction-monitor/node_modules/ | head -20 && exit 1)

# ---------- runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

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

CMD ["node","dist/server.js"]
