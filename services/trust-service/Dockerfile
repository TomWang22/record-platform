# Build from repo root: docker build -f services/trust-service/Dockerfile -t trust-service:dev .
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
COPY services/trust-service ./services/trust-service
COPY proto ./proto
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    rp-pnpm -w --filter @common/utils... --filter trust-service... install --no-frozen-lockfile --ignore-scripts
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
    rp-pnpm -C services/trust-service build
ARG TARGETARCH
COPY scripts/vendor/grpc_health_probe-linux-${TARGETARCH} /tmp/grpc-health-probe
RUN chmod +x /tmp/grpc-health-probe

FROM node:22-bookworm-slim
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="trust-service"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
WORKDIR /app/services/trust-service
ENV NODE_ENV=production
COPY --from=build /tmp/grpc-health-probe /usr/local/bin/grpc-health-probe
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/trust-service/node_modules ./node_modules
COPY --from=build /app/services/trust-service/dist ./dist
COPY --from=build /app/services/trust-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto
EXPOSE 4016 50066
CMD ["node", "dist/server.js"]
