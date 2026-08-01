# syntax=docker/dockerfile:1
# Build context: repository root
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
FROM node:22-alpine
ARG RP_SOURCE_SHA
ARG GIT_COMMIT
WORKDIR /app
COPY services/ollama-worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY services/ollama-worker/worker.js ./
ENV NODE_ENV=production
ENV RP_SERVICE_NAME=ollama-worker
ENV RP_SOURCE_SHA=${RP_SOURCE_SHA}
ENV GIT_COMMIT=${GIT_COMMIT}
LABEL org.opencontainers.image.revision=${GIT_COMMIT}
LABEL rp.source_sha=${RP_SOURCE_SHA}
USER node
CMD ["node", "worker.js"]
