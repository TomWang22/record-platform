# Microservices, gRPC, and Observability Implementation

## Current Status

### ✅ Completed
1. **HTTP/2 and HTTP/3 Support**
   - Caddy configured for HTTP/2 and HTTP/3 (QUIC)
   - Strict TLS (TLS 1.2/1.3 only)
   - CA rotation automation
   - Full chain: Caddy -> Ingress -> Gateway -> Services

2. **Database Setup**
   - Auth schema with users table
   - Records schema with partitions
   - Proper roles and permissions (record_app, record_owner)
   - Database initialization scripts

3. **gRPC Infrastructure**
   - Proto files: `proto/auth.proto`, `proto/records.proto`
   - gRPC Ingress configuration
   - Service definitions ready

4. **Observability Infrastructure**
   - Jaeger deployment (distributed tracing)
   - OpenTelemetry Collector deployment
   - Common tracing module (`services/common/src/tracing.ts`)

### 🔧 In Progress
1. **Auth Service Prisma Schema**
   - Issue: Prisma not respecting `search_path=auth` from connection string
   - Working on: Ensuring Prisma uses auth schema correctly

2. **gRPC Server Implementation**
   - Need to: Generate gRPC code from proto files
   - Need to: Implement gRPC servers in services
   - Need to: Test gRPC endpoints

### 📋 Next Steps

#### Phase 1: Fix Auth Service & Test HTTP/2/3
1. Fix Prisma schema issue (use `prisma.auth.user` or ensure search_path works)
2. Test auth registration/login via HTTP/2
3. Test auth registration/login via HTTP/3
4. Verify strict TLS works end-to-end

#### Phase 2: Implement gRPC
1. Generate gRPC code:
   ```bash
   ./scripts/generate-grpc-code.sh
   ```
2. Implement gRPC server in `auth-service`:
   - Add gRPC server on port 50051
   - Implement `AuthService` methods from `proto/auth.proto`
   - Support both REST and gRPC
3. Implement gRPC server in `records-service`:
   - Add gRPC server on port 50051
   - Implement `RecordsService` methods from `proto/records.proto`
   - Support both REST and gRPC
4. Test gRPC endpoints:
   ```bash
   # Install grpcurl
   brew install grpcurl
   
   # Test auth service
   grpcurl -insecure -H "Host: record.local" \
     record.local:8443 \
     auth.AuthService/HealthCheck
   ```

#### Phase 3: Observability Stack
1. **Prometheus**
   - Deploy Prometheus for metrics collection
   - Configure service discovery
   - Scrape `/metrics` endpoints from services
   - Set up retention policies

2. **Grafana**
   - Deploy Grafana
   - Configure Prometheus as datasource
   - Create dashboards for:
     - Service metrics (request rate, latency, errors)
     - Database metrics
     - HTTP/2/3 metrics
     - gRPC metrics

3. **OpenTelemetry**
   - Ensure all services use `initTracing()` from `@common/utils/tracing`
   - Verify traces flow to OpenTelemetry Collector
   - Configure trace sampling

4. **Jaeger**
   - Verify traces appear in Jaeger UI
   - Set up trace correlation
   - Configure trace retention

5. **Service Mesh** (Choose one)
   - **Istio**: Full-featured, more complex
   - **Linkerd**: Simpler, lighter weight
   - Configure mTLS between services
   - Set up service discovery
   - Configure traffic policies

6. **Monitoring & Alerting**
   - Set up alert rules in Prometheus
   - Configure alertmanager
   - Create alerts for:
     - High error rates
     - High latency (p95, p99)
     - Service downtime
     - Database connection issues

## Testing Commands

### HTTP/2/3 Testing
```bash
# Test auth registration via HTTP/2
/opt/homebrew/opt/curl/bin/curl -k -sS --http2 \
  -H "Host: record.local" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/register" \
  -d '{"email":"test@example.com","password":"test123"}'

# Test auth login via HTTP/3
/opt/homebrew/opt/curl/bin/curl -k -sS --http3-only \
  -H "Host: record.local" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/login" \
  -d '{"email":"test@example.com","password":"test123"}'

# Test with strict TLS (no -k flag, requires CA trust)
curl -sS --http2 \
  -H "Host: record.local" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/register" \
  -d '{"email":"test@example.com","password":"test123"}'
```

### gRPC Testing
```bash
# Install grpcurl
brew install grpcurl

# Test auth service health check
grpcurl -insecure -H "Host: record.local" \
  record.local:8443 \
  auth.AuthService/HealthCheck

# Test auth service authenticate
grpcurl -insecure -H "Host: record.local" \
  -d '{"email":"test@example.com","password":"test123"}' \
  record.local:8443 \
  auth.AuthService/Authenticate
```

## Observability Endpoints

### Prometheus
- Service: `prometheus.observability.svc.cluster.local:9090`
- Metrics endpoint: `/metrics`
- Query API: `/api/v1/query`

### Grafana
- Service: `grafana.observability.svc.cluster.local:3000`
- Default credentials: `admin/admin`
- Prometheus datasource: `http://prometheus.observability.svc.cluster.local:9090`

### Jaeger
- UI: Port-forward `svc/jaeger 16686:16686` then visit `http://localhost:16686`
- Collector: `jaeger.record-platform.svc.cluster.local:14250`

### OpenTelemetry Collector
- OTLP gRPC: `otel-collector.record-platform.svc.cluster.local:4317`
- OTLP HTTP: `otel-collector.record-platform.svc.cluster.local:4318`
- Prometheus: `otel-collector.record-platform.svc.cluster.local:8889`

## Database Performance (After Observability)

Once gRPC and observability are working:
1. Analyze good run settings from backups (1.13M records, partitions)
2. Restore optimal PostgreSQL configuration
3. Optimize indexes
4. Tune for 28k TPS target
5. Run benchmarks and verify performance
