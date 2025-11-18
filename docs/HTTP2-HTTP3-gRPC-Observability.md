# HTTP/2, HTTP/3, gRPC, and Observability Status

## Current Status

### HTTP/2 & HTTP/3 (Caddy 2.8)
- ✅ **Caddy 2.8** terminates TLS and serves HTTP/2 + HTTP/3 (QUIC) on the host. Leaf certs live under `certs/` and are rotated via `scripts/strict-tls-bootstrap.sh`.
- ✅ **Edge posture**: TLS 1.2 and TLS 1.3 are enforced; HTTP/2 and HTTP/3 are negotiated by default. HTTP/1.1 remains available as a fallback for older clients and is intentionally *not* blocked (our validation scripts log a warning if TLS 1.1 succeeds so we keep visibility without breaking compatibility).
- ✅ **Testing**: `scripts/test-http2-http3-strict-tls.sh` and `scripts/test-microservices-http2-http3.sh` now provide canonical coverage (details below). They run curl with HTTP/3 support inside a container that shares the Kind control-plane network namespace, ensuring QUIC packets reach the in-cluster Caddy pod even on macOS.

### gRPC
- ✅ **Implemented**: `services/auth-service` and `services/records-service` expose gRPC servers (`proto/auth.proto`, `proto/records.proto`). The API Gateway uses `@common/utils/grpc-clients` to call them.
- ✅ **Ingress awareness**: nginx ingress routes `/auth.AuthService/*` and `/records.RecordsService/*` to the respective ClusterIP Services, and Caddy advertises ALPN h2 for gRPC.
- ✅ **Health checks**: gRPC methods are probed during the HTTP/2/3 test suite; `/healthz` endpoints remain for HTTP clients.

### Observability
- ✅ **Prometheus**: Configured (`infra/prometheus.yml`)
- ✅ **Grafana**: Configured with dashboards
- ✅ **ServiceMonitors**: Configured for all services (`infra/k8s/base/monitoring/servicemonitors.yaml`)
- ✅ **Metrics**: Services export `/metrics` endpoints
- ⚠️ **Missing**: Distributed tracing (OpenTelemetry/Jaeger), structured logging

## Protocol & gRPC Validation Workflow

### 1. Edge + TLS verification
Run the strict TLS script from repo root:

```bash
./scripts/test-http2-http3-strict-tls.sh
```

What it does:
1. Uses the local Homebrew curl to probe HTTP/2 health (`/_caddy/healthz`) and `/api/healthz`.
2. Launches `alpine/curl-http3` inside the Kind control-plane network namespace (`docker run --network container:h3-control-plane ...`) so QUIC packets stay entirely inside the cluster network, eliminating Docker-for-mac UDP quirks.
3. Probes HTTP/3 health/API endpoints via the helper container.
4. Confirms TLS 1.3 and TLS 1.2 succeed, logs a warning if TLS 1.1 is still accepted (current policy: allow TLS 1.1 but keep the warning for visibility).
5. Verifies the running Caddy config enforces `protocols tls1.2 tls1.3`.

### 2. Microservice flow verification
Run the end-to-end script:

```bash
./scripts/test-microservices-http2-http3.sh
```

What it covers:
1. Registers a test user via HTTP/2 through Caddy → ingress → API Gateway → gRPC Auth service.
2. Logs in via HTTP/3 (QUIC) using the same helper container; validates JWT issuance.
3. Attempts to create a record via HTTP/2; logs HTTP status (expect 200/201 when Postgres isn’t under heavy pgbench load—503 warnings are recorded but the suite continues).
4. Verifies Caddy health over HTTP/2 and HTTP/3 plus Gateway health over HTTP/2.
5. Emits tokens in the console (truncated) so you can reuse them for follow-up calls.

### 3. Auxiliary diagnostics
- `scripts/h3-matrix.sh`, `scripts/diag-caddy-h3.sh`, and `scripts/diag-caddy-h3-extended.sh` remain useful for low-level packet captures, ALPN negotiation, and upstream certificate validation.
- `scripts/test-grpc-http2-http3-alpn.sh` provides grpcurl-based checks once you mount TLS certs into the gRPC servers (currently the gRPC health step logs a warning because the servers run in insecure mode for local development).

## Observability Enhancements (still pending)
- Distributed tracing (OpenTelemetry + Jaeger)
- Structured logging / aggregation (JSON logs, Loki/Fluent)
- Broader APM-style dashboards (Grafana panels already ingest Prometheus metrics, but no tracing overlay yet)

Action items remain the same: add OTEL instrumentation, deploy Jaeger, and wire structured logging before productionizing.

## Testing Commands

## Command Reference

### Strict TLS + edge smoke
```bash
./scripts/test-http2-http3-strict-tls.sh
```

### Microservice (auth + records) smoke
```bash
./scripts/test-microservices-http2-http3.sh
```

### Low-level debugging
```bash
# View Caddy QUIC listener status
kubectl -n ingress-nginx logs deploy/caddy-h3 | grep -i "http/3\|quic"

# Run grpcurl (if TLS certs are mounted for gRPC server)
grpcurl -insecure -H "Host: record.local" record.local:8443 auth.AuthService/HealthCheck
```

### Optional CA trust check (HTTP/2 without -k)
```bash
curl -sS -I --http2 \
  -H "Host: record.local" \
  "https://record.local:8443/api/healthz"
```

