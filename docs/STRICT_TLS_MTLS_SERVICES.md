# Strict TLS/mTLS — All Services

All gRPC backends use **strict TLS and mTLS**: server TLS with client certificate verification. No HTTP health probes on gRPC ports; probes use `grpc-health-probe` with TLS and client certs.

## Contract

- **Server TLS**: Each gRPC service listens with TLS (key/cert from `service-tls` secret at `/etc/certs/`). Env `TLS_KEY_PATH`/`TLS_CERT_PATH` point to `/etc/certs/tls.key` and `/etc/certs/tls.crt`.
- **Client cert required**: `GRPC_REQUIRE_CLIENT_CERT=true` so only clients that present a valid client cert (e.g. Envoy) can call the backend.
- **Probes**: Startup, readiness, and liveness use `grpc-health-probe` with:
  - `-tls`
  - `-tls-no-verify=false`
  - `-tls-ca-cert=/etc/certs/ca.crt`
  - `-tls-client-cert=/etc/certs/tls.crt`
  - `-tls-client-key=/etc/certs/tls.key`
  - `-tls-server-name=record.local`

## Services (gRPC + strict TLS/mTLS)

| Service           | GRPC_PORT | Env GRPC_REQUIRE_CLIENT_CERT | TLS_CA_PATH        | service-tls mount | Probes      |
|-------------------|-----------|-------------------------------|--------------------|-------------------|-------------|
| auth-service      | 50051     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| records-service   | 50051     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| listings-service  | 50057     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| messaging-service    | 50056     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| shopping-service  | 50058     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| analytics-service | 50054     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| auction-monitor   | 50059     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |
| python-ai-service | 50060     | true                          | /certs/dev-root.pem| /etc/certs        | gRPC+TLS    |

## Secret `service-tls`

Must contain (with paths used by probes and app):

- `tls.key` → `/etc/certs/tls.key`
- `tls.crt` → `/etc/certs/tls.crt`
- `ca.crt`  → `/etc/certs/ca.crt`

All deploy manifests use `items` so these paths are fixed. Certificate must be valid for SNI `record.local` for probe and Envoy.

## Edge (HTTP only)

- **api-gateway**: HTTP server only; uses HTTP `/healthz` for probes. Outbound gRPC to backends uses client certs from `service-tls`.
- **nginx**: Reverse proxy; HTTP health check.

## Build

- Node/TS services: `docker build -f services/<name>/Dockerfile .` (repo root context).
- python-ai-service: **context must be repo root**: `docker build -f services/python-ai-service/Dockerfile .` (so `proto/` and `services/python-ai-service/` paths resolve).
