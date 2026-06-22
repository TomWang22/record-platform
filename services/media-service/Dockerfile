# --- deps ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm
COPY scripts/docker/rp-corepack-pnpm.sh /usr/local/bin/rp-corepack-pnpm
COPY scripts/vendor/pnpm-11.1.3.tgz /tmp/rp-vendor/pnpm-11.1.3.tgz
RUN chmod +x /usr/local/bin/rp-corepack-pnpm && rp-corepack-pnpm
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/media-service ./services/media-service

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    rp-pnpm -w --filter @common/utils... --filter media-service... install --frozen-lockfile --ignore-scripts

# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
ENV NPM_CONFIG_CONFIRM_MODULES_PURGE=false
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
COPY scripts/docker/rp-corepack-pnpm.sh /usr/local/bin/rp-corepack-pnpm
COPY scripts/vendor/pnpm-11.1.3.tgz /tmp/rp-vendor/pnpm-11.1.3.tgz
RUN chmod +x /usr/local/bin/rp-corepack-pnpm && rp-corepack-pnpm
COPY scripts/docker/rp-pnpm-ci-install.sh /usr/local/bin/rp-pnpm
RUN chmod +x /usr/local/bin/rp-pnpm

COPY --from=deps /app /app

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -C services/common build

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -C services/media-service build
ARG TARGETARCH
COPY scripts/vendor/grpc_health_probe-linux-${TARGETARCH} /tmp/grpc-health-probe
RUN chmod +x /tmp/grpc-health-probe

# --- runtime ---
FROM node:22-bookworm-slim
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="media-service"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
WORKDIR /app/services/media-service

ENV NODE_ENV=production
COPY --from=build /tmp/grpc-health-probe /usr/local/bin/grpc-health-probe

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/media-service/node_modules ./node_modules
COPY --from=build /app/services/media-service/dist ./dist
COPY --from=build /app/services/media-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common

EXPOSE 4018 50068
CMD ["node", "dist/server.js"]
