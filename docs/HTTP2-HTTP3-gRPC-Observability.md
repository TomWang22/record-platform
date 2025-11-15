# HTTP/2, HTTP/3, gRPC, and Observability Status

## Current Status

### HTTP/2 & HTTP/3 (Caddy 2.8)
- ✅ **Caddy 2.8** is deployed with HTTP/3 support (automatic in Caddy 2.8)
- ✅ **Caddyfile** configured with `versions h2 h1` for upstream (HTTP/2 preferred)
- ⚠️ **Issue**: curl with `--http2` and `--http3-only` flags not working
- ⚠️ **CA Trust**: Currently using `tls_trusted_ca_certs /etc/caddy/ca/dev-root.pem` (mkcert CA)

### gRPC
- ⚠️ **Not fully configured**: nginx.tmpl has gRPC support but no actual gRPC services defined
- ⚠️ **Missing**: gRPC service definitions, protobuf definitions, gRPC gateway

### Observability
- ✅ **Prometheus**: Configured (`infra/prometheus.yml`)
- ✅ **Grafana**: Configured with dashboards
- ✅ **ServiceMonitors**: Configured for all services (`infra/k8s/base/monitoring/servicemonitors.yaml`)
- ✅ **Metrics**: Services export `/metrics` endpoints
- ⚠️ **Missing**: Distributed tracing (OpenTelemetry/Jaeger), structured logging

## Issues to Fix

### 1. HTTP/2 & HTTP/3 Testing
**Problem**: curl with `--http2` and `--http3-only` flags not working

**Root Causes**:
- Need curl with HTTP/3 support (requires nghttp3 library)
- CA certificate trust issues
- Caddy upstream configuration might need adjustment

**Solutions**:
1. Use curl with HTTP/3 support: `/opt/homebrew/opt/curl/bin/curl` (as in h3_doctor.sh)
2. Test CA trust: Ensure `dev-root.pem` is properly mounted
3. Verify Caddy is actually serving HTTP/3 (check logs)

### 2. gRPC Setup
**Missing Components**:
- gRPC service definitions (protobuf files)
- gRPC server implementations in services
- gRPC gateway for HTTP/1.1 to gRPC translation
- Ingress configuration for gRPC (nginx supports it)

**Action Items**:
1. Create `.proto` files for service APIs
2. Generate gRPC server/client code
3. Implement gRPC servers in services
4. Configure nginx ingress for gRPC (already has support in nginx.tmpl)
5. Add gRPC health checks

### 3. Observability Enhancements
**Missing**:
- Distributed tracing (OpenTelemetry/Jaeger)
- Structured logging (JSON logs, log aggregation)
- APM (Application Performance Monitoring)

**Action Items**:
1. Add OpenTelemetry instrumentation to services
2. Deploy Jaeger for distributed tracing
3. Configure structured logging (JSON format)
4. Add log aggregation (Loki or similar)
5. Enhance Grafana dashboards with tracing data

## Testing Commands

### Test HTTP/2
```bash
# Using curl with HTTP/2 support
/opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 \
  -H "Host: record.local" \
  "https://record.local:8443/api/healthz"
```

### Test HTTP/3
```bash
# Using curl with HTTP/3 support
/opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only \
  -H "Host: record.local" \
  "https://record.local:8443/api/healthz"
```

### Verify Caddy HTTP/3
```bash
# Check Caddy logs
kubectl -n ingress-nginx logs deploy/caddy-h3 | grep -i "http3\|quic"
```

### Test CA Trust
```bash
# Test without -k flag (should work if CA is trusted)
curl -sS -I --http2 \
  -H "Host: record.local" \
  "https://record.local:8443/api/healthz"
```

## Next Steps

1. **Fix HTTP/2/3 Testing**:
   - Verify curl version supports HTTP/3
   - Test CA certificate trust
   - Check Caddy configuration

2. **Implement gRPC**:
   - Start with one service (e.g., records-service)
   - Create protobuf definitions
   - Implement gRPC server
   - Configure ingress

3. **Enhance Observability**:
   - Add OpenTelemetry
   - Deploy Jaeger
   - Configure structured logging
   - Create tracing dashboards

