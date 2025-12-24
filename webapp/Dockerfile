# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy package manifests (changes rarely, good for caching)
# Only copy what's needed for dependency installation
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY webapp/package.json ./webapp/package.json

# Use BuildKit cache mounts for pnpm store (persists between builds)
# Parallel install with ignore-scripts for faster install
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter webapp... install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy installed dependencies from deps stage
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
# Copy in order: config files first (rarely change), then source
COPY webapp/next.config.mjs webapp/tsconfig.json webapp/tailwind.config.ts webapp/postcss.config.mjs ./webapp/
COPY webapp/app ./webapp/app
COPY webapp/components ./webapp/components
COPY webapp/lib ./webapp/lib
COPY webapp/middleware.ts ./webapp/
RUN mkdir -p webapp/public

# Build from webapp directory so path aliases resolve correctly
WORKDIR /app/webapp

# Build with cache mount for faster subsequent builds
# Use standalone output for smaller runtime image
# Cache TypeScript build info for incremental builds
# Parallel build optimization
ENV NEXT_TELEMETRY_DISABLED=1
# Show build progress and use parallel compilation
ENV NODE_OPTIONS="--max-old-space-size=4096"
# Build with progress output (so it doesn't look stuck)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=next-cache,target=/app/webapp/.next/cache \
    --mount=type=cache,id=ts-buildinfo,target=/app/webapp/.next/tsconfig.tsbuildinfo \
    echo "=== Starting Next.js build (this takes 2-5 minutes) ===" && \
    echo "Progress will be shown below..." && \
    pnpm build || (echo "Build failed!" && exit 1) && \
    echo "=== Next.js build complete ==="

# Prune production dependencies after build
WORKDIR /app
RUN cd webapp && pnpm prune --prod

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (much smaller - only production dependencies)
# Use --chown to set ownership in one step
COPY --from=build --chown=nextjs:nodejs /app/webapp/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/webapp/.next/static ./webapp/.next/static
COPY --from=build --chown=nextjs:nodejs /app/webapp/public ./webapp/public

# Remove source maps, dev files, and unnecessary files to reduce size
RUN find ./webapp/.next -name "*.map" -delete 2>/dev/null || true \
    && find ./webapp/.next -type d -name "cache" -exec rm -rf {} + 2>/dev/null || true \
    && rm -rf ./webapp/.next/server/chunks/development 2>/dev/null || true \
    && rm -rf ./webapp/.next/server/app-paths-manifest.json 2>/dev/null || true

USER nextjs

EXPOSE 3001
# Use standalone server (fastest startup)
CMD ["node","webapp/server.js"]
