"""gRPC aio server interceptor: one span per RPC with W3C extract/inject."""
from __future__ import annotations

from typing import Any, Callable, Optional


def create_grpc_tracing_interceptor():
    """Lazy factory so unit tests can import helpers without opentelemetry installed."""
    import grpc
    from opentelemetry import context, trace
    from opentelemetry.propagate import extract
    from opentelemetry.trace import SpanKind, Status, StatusCode

    class _MetadataCarrier(dict):
        def get(self, key: str, default: Any = None) -> Any:  # type: ignore[override]
            for k, v in self.items():
                if str(k).lower() == key.lower():
                    return v
            return default

    class GrpcTracingInterceptor(grpc.aio.ServerInterceptor):
        async def intercept_service(self, continuation: Callable, handler_call_details):  # type: ignore[no-untyped-def]
            handler = await continuation(handler_call_details)
            if handler is None:
                return None

            method = getattr(handler_call_details, "method", "") or "unknown"
            tracer = trace.get_tracer("python-ai-grpc")

            def _wrap_unary_unary(behavior):  # type: ignore[no-untyped-def]
                async def _inner(request, context):  # type: ignore[no-untyped-def]
                    md = dict(handler_call_details.invocation_metadata or [])
                    carrier = _MetadataCarrier({str(k): str(v) for k, v in md.items()})
                    parent = extract(carrier)
                    with tracer.start_as_current_span(
                        f"gRPC {method}",
                        context=parent,
                        kind=SpanKind.SERVER,
                    ) as span:
                        span.set_attribute("rpc.system", "grpc")
                        span.set_attribute("rpc.method", method)
                        span.set_attribute("network.protocol.name", "grpc")
                        try:
                            result = await behavior(request, context)
                            code = getattr(context, "code", lambda: None)()
                            if code is not None and code != grpc.StatusCode.OK:
                                span.set_attribute("rpc.grpc.status_code", int(code.value[0]))
                                span.set_status(Status(StatusCode.ERROR, str(code)))
                            else:
                                span.set_attribute("rpc.grpc.status_code", 0)
                            return result
                        except Exception as exc:  # noqa: BLE001
                            span.record_exception(exc)
                            span.set_status(Status(StatusCode.ERROR, str(exc)))
                            raise

                return _inner

            if handler.unary_unary:
                return grpc.unary_unary_rpc_method_handler(
                    _wrap_unary_unary(handler.unary_unary),
                    request_deserializer=handler.request_deserializer,
                    response_serializer=handler.response_serializer,
                )
            # Pass through streaming handlers without wrapping for Gate 3 unary coverage.
            return handler

    return GrpcTracingInterceptor()


def build_server_interceptors(peer_auth_interceptor: Optional[Any] = None) -> list:
    """Tracing first (outer), then peer-auth — mirrors Node createRpGrpcServer order."""
    interceptors: list = []
    try:
        interceptors.append(create_grpc_tracing_interceptor())
    except Exception as exc:  # noqa: BLE001
        print(f"[otel] gRPC tracing interceptor unavailable: {exc}")
    if peer_auth_interceptor is not None:
        interceptors.append(peer_auth_interceptor)
    return interceptors
