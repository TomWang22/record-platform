# syntax=docker/dockerfile:1
#
# Build context MUST be repo root (so proto/ and services/ paths resolve).
# From repo root run:
#   docker build -f services/python-ai-service/Dockerfile -t python-ai-service:dev .
# Do NOT run: docker build -t python-ai-service:dev services/python-ai-service
# (that uses service dir as context and COPY paths will fail).

# ---------- deps ----------
FROM python:3.11-slim AS deps

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Copy requirements (changes rarely, good for caching)
# Context = repo root: COPY services/python-ai-service/requirements.txt
COPY services/python-ai-service/requirements.txt /tmp/requirements.txt

# Install build deps with apt cache mount (faster installs)
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt \
    apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install Python dependencies with pip cache mount (persists between builds)
RUN --mount=type=cache,id=pip-cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip \
 && pip install --no-cache-dir -r /tmp/requirements.txt

# ---------- build ----------
FROM python:3.11-slim AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Copy installed dependencies from deps stage
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy proto files and generate Python stubs
COPY proto /tmp/proto
RUN python -m grpc_tools.protoc \
    --python_out=/app \
    --grpc_python_out=/app \
    --proto_path=/tmp/proto \
    /tmp/proto/python-ai.proto \
    /tmp/proto/health.proto \
    && ls -la /app/*.py | head -5 || echo "Proto generation completed"

# Copy the app from monorepo path (build from repo root)
COPY services/python-ai-service/app /app/app

# ---------- runtime ----------
FROM python:3.11-slim
ARG RP_SOURCE_SHA=unknown
ARG GIT_COMMIT=unknown
LABEL rp.dev.service="python-ai-service"
LABEL rp.dev.source-sha="${RP_SOURCE_SHA}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NODE_ENV=production

WORKDIR /app

# Create non-root user for security
RUN groupadd -r python && useradd -r -g python python

# Copy only runtime dependencies and app
COPY --from=build --chown=python:python /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build --chown=python:python /usr/local/bin /usr/local/bin
COPY --from=build --chown=python:python /app /app
# Repo-pinned grpc-health-probe (same source as other RP services; no runtime download)
ARG TARGETARCH
COPY scripts/vendor/grpc_health_probe-linux-${TARGETARCH} /usr/local/bin/grpc-health-probe
RUN chmod 755 /usr/local/bin/grpc-health-probe \
 && /usr/local/bin/grpc-health-probe -version >/dev/null 2>&1 \
 && ls -la /usr/local/bin/grpc-health-probe

# Phase 33C–E deterministic engines shell out to Node runners (fail-closed if absent).
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY scripts/ai-platform/run-phase33c-capability.mjs \
     scripts/ai-platform/run-phase33d-capability.mjs \
     scripts/ai-platform/run-phase33e-capability.mjs \
     /app/scripts/ai-platform/
COPY scripts/lib/phase33a-intelligence-capability-contracts.mjs \
     scripts/lib/phase33c-auction.mjs \
     scripts/lib/phase33c-confidence.mjs \
     scripts/lib/phase33c-evidence.mjs \
     scripts/lib/phase33c-intelligence.mjs \
     scripts/lib/phase33c-scarcity.mjs \
     scripts/lib/phase33c-valuation.mjs \
     scripts/lib/phase33d-intelligence.mjs \
     scripts/lib/phase33d-negotiation.mjs \
     scripts/lib/phase33d-recommendations.mjs \
     scripts/lib/phase33e-analytics.mjs \
     scripts/lib/phase33e-intelligence.mjs \
     scripts/lib/phase33e-memory.mjs \
     scripts/lib/phase34-negotiation-context.mjs \
     scripts/lib/phase34-owner-proof-completed-sale-candidates.mjs \
     /app/scripts/lib/
RUN chown -R python:python /app/scripts \
 && node --version >/dev/null

# Remove unnecessary files (cache only - keep .dist-info for package metadata)
RUN find /usr/local/lib/python3.11/site-packages -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/local/lib/python3.11/site-packages -type f -name "*.pyc" -delete 2>/dev/null || true \
    && find /usr/local/lib/python3.11/site-packages -type f -name "*.pyo" -delete 2>/dev/null || true

USER python

EXPOSE 5005 50060
CMD ["gunicorn", "-c", "app/gunicorn.conf.py", "app.ai_main:app"]
