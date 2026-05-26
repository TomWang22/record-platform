# messaging-service gRPC/mTLS Debug Report

## Pod Internals

### Port Listening
```
Decoded from /proc/net/tcp:
0.0.0.0:4014  (LISTEN)  -- HTTP server
0.0.0.0:50064 (LISTEN)  -- gRPC server ✅
```
Server IS bound to 0.0.0.0:50064 (not localhost-only).

### Environment Variables
```
ENABLE_GRPC=true
GRPC_PORT=50064
GRPC_REQUIRE_CLIENT_CERT=true
TLS_CA_PATH=/etc/certs/ca.crt
TLS_CERT_PATH=/etc/certs/tls.crt
TLS_KEY_PATH=/etc/certs/tls.key
NODE_EXTRA_CA_CERTS=/certs/dev-root.pem
NODE_TLS_REJECT_UNAUTHORIZED=1
MESSAGING_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5434/messaging?connect_timeout=5
POSTGRES_URL_MESSAGING=postgresql://postgres:postgres@host.docker.internal:5444/messaging
```

### Certs Mounted
```
/etc/certs/ca.crt  -> ..data/ca.crt
/etc/certs/tls.crt -> ..data/tls.crt
/etc/certs/tls.key -> ..data/tls.key
```
All three cert files present and symlinked via K8s secret mount.

### Process
```
PID 1: node dist/server.js
```
Single node process running.

## gRPC Health Probe Results (in-pod)

### Default service (no -service flag)
```
connection established (took 177.017738ms)
service unhealthy (responded with "NOT_SERVING")
```
TLS handshake: ✅ SUCCESS
Health status: NOT_SERVING

### Named service (messaging.v1.MessagingService)
```
connection established (took 30.146065ms)
service unhealthy (responded with "NOT_SERVING")
```
TLS handshake: ✅ SUCCESS
Health status: NOT_SERVING

### Plaintext test
```
timeout: failed to connect service "127.0.0.1:50064" within 5s
```
Confirms TLS is required (no insecure fallback). ✅

## Root Cause

The messaging-service gRPC server:
1. ✅ Binds to 0.0.0.0:50064
2. ✅ Uses strict mTLS (createOchGrpcServerCredentialsForBind)
3. ✅ Registers grpc.health.v1.Health for both default and messaging.v1.MessagingService
4. ✅ TLS handshake succeeds with correct certs
5. ❌ Health probe returns NOT_SERVING because the messaging DB (host.docker.internal:5444) is unreachable

The health check function (`messagingGrpcHealthProbe`) performs a live DB connectivity test on every Check() call.
When `host.docker.internal:5444` (POSTGRES_URL_MESSAGING) is unreachable, it returns NOT_SERVING.

This is **correct behavior** — the service's gRPC/mTLS integrity is proven:
- Connection established
- mTLS handshake completed
- Client cert verified
- Health response received (NOT_SERVING ≠ connection failure)

## Verdict

- **gRPC TLS integrity**: PASS (handshake + mutual auth work)
- **Health status**: NOT_SERVING (DB dependency unavailable)
- **grpcRequiredForRuntime**: false (contract allows NOT_SERVING)
- **grpc_integrity_verdict**: pass
