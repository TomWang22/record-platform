"""Initialize OpenTelemetry tracing for python-ai-service (OTLP HTTP → Jaeger)."""
from __future__ import annotations

import os
from typing import Optional

_initialized = False


def init_tracing(service_name: Optional[str] = None) -> None:
    """Start the OTEL SDK once. Safe to call multiple times."""
    global _initialized
    if _initialized:
        return
    if os.getenv("OTEL_SDK_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError as exc:
        print(f"[otel] OpenTelemetry packages not installed; traces disabled: {exc}")
        return

    name = (
        (os.getenv("OTEL_SERVICE_NAME") or "").strip()
        or (service_name or "").strip()
        or "python-ai-service"
    )
    direct = (os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or "").strip()
    base = (
        (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
        or (os.getenv("OCH_OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
    )
    if direct:
        traces_url = direct
    elif base:
        normalized = base.rstrip("/")
        traces_url = normalized if normalized.endswith("/v1/traces") else f"{normalized}/v1/traces"
    else:
        traces_url = "http://jaeger.observability.svc.cluster.local:4318/v1/traces"

    resource = Resource.create(
        {
            "service.name": name,
            "service.version": (os.getenv("SERVICE_VERSION") or "0.0.0").strip(),
        }
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=traces_url)))
    trace.set_tracer_provider(provider)
    _initialized = True
    print("OpenTelemetry initialized")
    print("Tracing → Jaeger / OTLP collector (OTLP HTTP)")
    print(f"[otel] service={name} traces=otlp")
