# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Copy package manifests (changes rarely, good for caching)
# Only copy what's needed for dependency installation
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY .npmrc ./
COPY webapp/package.json ./webapp/package.json

# Use BuildKit cache mounts for pnpm store (persists between builds)
# Parallel install with ignore-scripts for faster install
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    rp-pnpm -w --filter webapp... install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM node:22-alpine AS build
ARG GIT_COMMIT=unknown
ARG RP_WEBAPP_BUILD_AT=unknown
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NPM_CONFIG_CONFIRM_MODULES_PURGE=false
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
ENV RP_WEBAPP_BUILD_SHA="${GIT_COMMIT}"
ENV RP_WEBAPP_BUILD_AT="${RP_WEBAPP_BUILD_AT}"
ENV NEXT_PUBLIC_RP_WEBAPP_BUILD_SHA="${GIT_COMMIT}"
ENV NEXT_PUBLIC_RP_WEBAPP_BUILD_AT="${RP_WEBAPP_BUILD_AT}"
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Copy installed dependencies from deps stage
COPY --from=deps /app /app

# Copy source code (changes frequently, invalidates cache)
# Copy in order: config files first (rarely change), then source
COPY webapp/next.config.mjs webapp/tsconfig.json webapp/tailwind.config.ts webapp/postcss.config.mjs ./webapp/
COPY webapp/app ./webapp/app
COPY webapp/components ./webapp/components
COPY webapp/lib ./webapp/lib
COPY webapp/middleware.ts ./webapp/
# Static assets (album sleeves, favicon) must ship in the image — never an empty public/
COPY webapp/public ./webapp/public

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
# Use unbuffered output so progress shows immediately
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    set -eu && \
    rm -rf /app/webapp/.next && \
    NODE_OPTIONS="--max-old-space-size=4096" NEXT_TELEMETRY_DISABLED=1 rp-pnpm build && \
    test -d /app/webapp/.next/standalone

# Prune production dependencies after build (standalone gate required)
WORKDIR /app
RUN test -d /app/webapp/.next/standalone && cd webapp && rp-pnpm prune --prod

# ---------- runtime ----------
FROM node:22-alpine
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
ARG RP_WEBAPP_BUILD_AT=unknown
LABEL rp.dev.service="webapp"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
WORKDIR /app
ENV RP_WEBAPP_BUILD_SHA="${GIT_COMMIT}"
ENV RP_WEBAPP_BUILD_AT="${RP_WEBAPP_BUILD_AT}"
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
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
# NOTE: Do NOT remove app-paths-manifest.json - Next.js needs it!
RUN find ./webapp/.next -name "*.map" -delete 2>/dev/null || true \
    && find ./webapp/.next -type d -name "cache" -exec rm -rf {} + 2>/dev/null || true \
    && rm -rf ./webapp/.next/server/chunks/development 2>/dev/null || true

USER nextjs

EXPOSE 3001
# Use standalone server (fastest startup)
CMD ["node","webapp/server.js"]
