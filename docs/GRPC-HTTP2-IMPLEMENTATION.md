# gRPC over HTTP/2 Implementation

## Problem Solved

The microservices were running in HTTP/1.1 mode behind an ingress expecting HTTP/2/3, causing:
- ALPN negotiation failures
- gRPC streams not establishing
- 500 Internal Server Errors

## Solution

### 1. gRPC Servers (HTTP/2 Only)

All gRPC servers are now configured to:
- Use HTTP/2 only (no HTTP/1.1 fallback)
- Support ALPN = h2 negotiation
- Include proper error handling with gRPC status codes
- Log all gRPC method calls

**Key Configuration:**
```typescript
const server = new grpc.Server({
  'grpc.keepalive_time_ms': 30000,
  'grpc.keepalive_timeout_ms': 5000,
  'grpc.keepalive_permit_without_calls': true,
  'grpc.http2.max_pings_without_data': 0,
  'grpc.http2.min_time_between_pings_ms': 10000,
  'grpc.http2.min_ping_interval_without_data_ms': 300000,
});
```

### 2. Ingress Configuration

**gRPC Ingress:**
- `nginx.ingress.kubernetes.io/backend-protocol: "GRPC"`
- `nginx.ingress.kubernetes.io/grpc-backend: "true"`
- `nginx.ingress.kubernetes.io/http2-push-preload: "true"`
- `nginx.ingress.kubernetes.io/proxy-body-size: "0"`

**Main Ingress:**
- `nginx.ingress.kubernetes.io/http2-push-preload: "true"`
- HTTP/2 upstream connections

### 3. ALPN Negotiation

- TLS certificates must support ALPN = h2
- Servers advertise h2 via ALPN
- No HTTP/1.1 fallback allowed

### 4. Error Handling

All gRPC methods use proper status codes:
- `grpc.status.INVALID_ARGUMENT` - Bad request
- `grpc.status.UNAUTHENTICATED` - Auth failures
- `grpc.status.NOT_FOUND` - Resource not found
- `grpc.status.INTERNAL` - Server errors
- `grpc.status.UNIMPLEMENTED` - Not implemented

### 5. Logging Middleware

All gRPC methods are wrapped with logging:
- Method name
- Request duration
- Error logging

## Testing

### HTTP/2 Test
```bash
curl -v --http2-prior-knowledge https://record.local:8443/_caddy/healthz
```

### HTTP/3 Test
```bash
curl -v --http3-only https://record.local:8443/_caddy/healthz
```

### gRPC Test
```bash
grpcurl -insecure -H "Host: record.local" \
  -d '{}' \
  record.local:8443 \
  auth.AuthService/HealthCheck
```

## Next Steps

1. Replace internal REST calls with gRPC clients
2. Test all endpoints via ingress
3. Verify no more 500 ISE errors
4. Monitor ALPN negotiation
