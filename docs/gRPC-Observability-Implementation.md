# gRPC and Observability Implementation

## Overview

This document outlines the gRPC and observability implementation for the Record Platform.

## gRPC Implementation

### Proto Files

- `proto/records.proto` - Records service definitions
- `proto/auth.proto` - Auth service definitions

### Services

1. **RecordsService** (`records.proto`)
   - `SearchRecords` - Fuzzy search with pagination
   - `GetRecord` - Get single record by ID
   - `CreateRecord` - Create new record
   - `UpdateRecord` - Update existing record
   - `DeleteRecord` - Delete record
   - `HealthCheck` - Health check endpoint

2. **AuthService** (`auth.proto`)
   - `Authenticate` - User authentication
   - `ValidateToken` - Token validation
   - `RefreshToken` - Token refresh
   - `HealthCheck` - Health check endpoint

### Code Generation

Run `./scripts/generate-grpc-code.sh` to generate TypeScript/Node.js code from .proto files.

### Ingress Configuration

gRPC ingress is configured in `infra/k8s/overlays/dev/ingress-grpc.yaml`:
- `/records.RecordsService/*` -> `records-service:50051`
- `/auth.AuthService/*` -> `auth-service:50051`

## Observability Stack

### Jaeger (Distributed Tracing)

- **Deployment**: `infra/k8s/base/observability/jaeger-deploy.yaml`
- **UI**: Port-forward `svc/jaeger 16686:16686` and visit `http://localhost:16686`
- **Collector Endpoint**: `jaeger.record-platform.svc.cluster.local:14250`

### OpenTelemetry Collector

- **Deployment**: `infra/k8s/base/observability/otel-collector-deploy.yaml`
- **OTLP gRPC**: `otel-collector.record-platform.svc.cluster.local:4317`
- **OTLP HTTP**: `otel-collector.record-platform.svc.cluster.local:4318`
- **Prometheus**: `otel-collector.record-platform.svc.cluster.local:8889`

### Instrumentation

1. **Common Tracing Module** (`services/common/src/tracing.ts`)
   - Auto-instrumentation for HTTP, Express, PostgreSQL, Redis
   - OTLP exporter to OpenTelemetry Collector
   - Service name and version from environment variables

2. **Usage in Services**

```typescript
// In service entry point (e.g., server.ts)
import { initTracing } from "@common/utils/tracing";

// Initialize before starting server
initTracing();

// Service will automatically be instrumented
```

3. **Environment Variables**

```bash
SERVICE_NAME=records-service
SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.record-platform.svc.cluster.local:4318
```

## Next Steps

1. **Generate gRPC Code**
   ```bash
   ./scripts/generate-grpc-code.sh
   ```

2. **Implement gRPC Servers**
   - Add gRPC server to `records-service`
   - Add gRPC server to `auth-service`
   - Implement service methods

3. **Add Instrumentation**
   - Import `initTracing` in service entry points
   - Add structured logging with correlation IDs
   - Add custom spans for business logic

4. **Test gRPC Endpoints**
   - Use `grpcurl` or `grpcui` for testing
   - Verify traces appear in Jaeger UI

## Database Performance

After gRPC and observability are complete, focus on:
1. Analyzing good run settings from backups
2. Optimizing for 28k TPS target
3. Tuning PostgreSQL parameters
4. Index optimization

