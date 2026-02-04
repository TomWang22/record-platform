# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM python:3.11-slim AS deps

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Copy requirements (changes rarely, good for caching)
# Build from root: docker build -f services/python-ai-service/Dockerfile -t python-ai-service:dev .
COPY services/python-ai-service/requirements.txt /tmp/requirements.txt

# Install build deps with apt cache mount (faster installs)
# Also install grpc-health-probe for Kubernetes health checks
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt \
    --mount=type=cache,id=apt-lib,target=/var/lib/apt \
    apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl wget ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && echo "Installing AMD64 grpc-health-probe (Kind clusters use amd64 even on ARM Macs)" \
 && GRPC_HEALTH_PROBE_VERSION=v0.4.24 \
 && curl -Lf -o /tmp/grpc-health-probe \
    "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64" \
 && chmod +x /tmp/grpc-health-probe \
 && /tmp/grpc-health-probe -version >/dev/null 2>&1 || (echo "ERROR: grpc-health-probe binary is corrupted or invalid" && exit 1) \
 && mv /tmp/grpc-health-probe /usr/local/bin/grpc-health-probe \
 && echo "Verifying installed binary..." \
 && /usr/local/bin/grpc-health-probe -version >/dev/null 2>&1 \
 && ls -lh /usr/local/bin/grpc-health-probe \
 && echo "✅ grpc-health-probe installed and verified successfully"

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

    # Copy the app from monorepo path
    # Build from root: docker build -f services/python-ai-service/Dockerfile -t python-ai-service:dev .
    COPY services/python-ai-service/app /app/app

# ---------- runtime ----------
FROM python:3.11-slim

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
# Copy grpc-health-probe from build stage with proper permissions (root:root so it can be executed)
# CRITICAL: Use platform-specific binary (amd64 for Kind clusters, even on ARM Macs)
COPY --from=deps --chown=root:root /usr/local/bin/grpc-health-probe /usr/local/bin/grpc-health-probe
RUN chmod 755 /usr/local/bin/grpc-health-probe && \
    # Verify binary is executable and correct architecture
    /usr/local/bin/grpc-health-probe --version 2>&1 | head -1 || echo "grpc-health-probe version check failed (may be wrong arch)" && \
    ls -la /usr/local/bin/grpc-health-probe || echo "grpc-health-probe not found"

# Remove unnecessary files (cache only - keep .dist-info for package metadata)
RUN find /usr/local/lib/python3.11/site-packages -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/local/lib/python3.11/site-packages -type f -name "*.pyc" -delete 2>/dev/null || true \
    && find /usr/local/lib/python3.11/site-packages -type f -name "*.pyo" -delete 2>/dev/null || true

USER python

EXPOSE 5005
CMD ["gunicorn", "-c", "app/gunicorn.conf.py", "app.ai_main:app"]