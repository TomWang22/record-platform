# OpenTelemetry Instrumentation Guide

This guide shows how to instrument your services with OpenTelemetry for distributed tracing and metrics.

## Overview

The OpenTelemetry Collector is deployed in the `observability` namespace and receives traces, metrics, and logs via OTLP (OpenTelemetry Protocol).

**Collector Endpoint:** `otel-collector.observability.svc.cluster.local:4317` (gRPC) or `:4318` (HTTP)

## Node.js/TypeScript Services

### 1. Install Dependencies

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-otlp-grpc
```

### 2. Create Instrumentation File

Create `instrumentation.ts` at the root of your service:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter, OTLPMetricExporter } from '@opentelemetry/exporter-otlp-grpc'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'unknown-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.observability.svc.cluster.local:4317',
  }),
  metricExporter: new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.observability.svc.cluster.local:4317',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-express': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: true,
      },
    }),
  ],
})

sdk.start()
console.log('OpenTelemetry instrumentation started')

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('OpenTelemetry terminated'))
    .catch((error) => console.error('Error terminating OpenTelemetry', error))
})
```

### 3. Import in Your Service Entry Point

In your main `server.ts` or `index.ts`, import the instrumentation **before** everything else:

```typescript
import './instrumentation'  // Must be first!
import express from 'express'
// ... rest of your imports
```

### 4. Environment Variables

Add to your deployment manifests:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector.observability.svc.cluster.local:4317"
  - name: OTEL_SERVICE_NAME
    value: "api-gateway"  # or your service name
  - name: OTEL_SERVICE_VERSION
    value: "1.0.0"
  - name: OTEL_RESOURCE_ATTRIBUTES
    value: "service.name=api-gateway,service.version=1.0.0,deployment.environment=production"
```

## Python Services

### 1. Install Dependencies

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-instrumentation opentelemetry-exporter-otlp
```

### 2. Instrument Your Application

```python
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor

# Set up tracing
resource = Resource.create({
    "service.name": os.getenv("SERVICE_NAME", "python-ai-service"),
    "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
})

provider = TracerProvider(resource=resource)
otlp_exporter = OTLPSpanExporter(
    endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector.observability.svc.cluster.local:4317"),
)
provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
trace.set_tracer_provider(provider)

# Auto-instrument FastAPI and requests
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()
```

## gRPC Services

For gRPC services, use the gRPC instrumentation:

```typescript
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc'

const sdk = new NodeSDK({
  instrumentations: [
    new GrpcInstrumentation(),
    // ... other instrumentations
  ],
})
```

## Manual Tracing

You can also create spans manually:

```typescript
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('my-service')

async function processRecord(recordId: string) {
  const span = tracer.startSpan('process_record', {
    attributes: { 'record.id': recordId },
  })
  
  try {
    // Your business logic
    await doSomething(recordId)
    span.setStatus({ code: SpanStatusCode.OK })
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    span.recordException(error)
    throw error
  } finally {
    span.end()
  }
}
```

## Metrics

Create custom metrics:

```typescript
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('my-service')

const requestCounter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
})

const responseTimeHistogram = meter.createHistogram('http_request_duration_seconds', {
  description: 'HTTP request duration in seconds',
})

// Use in your code
requestCounter.add(1, { method: 'GET', route: '/api/records', status: '200' })
responseTimeHistogram.record(duration, { method: 'GET', route: '/api/records' })
```

## Verification

1. Check if traces are reaching Jaeger:
   ```bash
   kubectl port-forward svc/jaeger -n observability 16686:16686
   # Open http://localhost:16686
   ```

2. Check metrics in Prometheus:
   ```bash
   kubectl port-forward svc/monitoring-kube-prom-prometheus -n monitoring 9090:9090
   # Open http://localhost:9090
   ```

3. Check OpenTelemetry Collector logs:
   ```bash
   kubectl logs -n observability deployment/otel-collector -f
   ```

## Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Node.js Instrumentation](https://opentelemetry.io/docs/instrumentation/js/getting-started/nodejs/)
- [Python Instrumentation](https://opentelemetry.io/docs/instrumentation/python/getting-started/)

