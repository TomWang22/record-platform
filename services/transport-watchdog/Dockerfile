# Build from repo root: docker build -t transport-watchdog:dev -f services/transport-watchdog/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
ENV NPM_CONFIG_CONFIRM_MODULES_PURGE=false
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
COPY services/transport-watchdog/package.json services/transport-watchdog/tsconfig.json ./
COPY services/transport-watchdog/src ./src
RUN npm install && npm run build

FROM node:22-bookworm-slim
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="transport-watchdog"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
WORKDIR /app
COPY services/transport-watchdog/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
