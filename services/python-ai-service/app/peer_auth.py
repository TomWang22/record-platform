"""gRPC peer-identity authorization for python-ai-service.

Mirrors services/common grpc-peer-auth: CA trust alone is insufficient; caller
DNS/SPIFFE identity from the authenticated client certificate must be in the
service-call graph allowedCallers for this server.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

SERVICE_NAME = "python-ai-service"

_GRAPH_CANDIDATES = (
    os.getenv("RP_SERVICE_CALL_GRAPH_PATH", ""),
    "/app/contracts/rp-service-call-graph.json",
    "/contracts/rp-service-call-graph.json",
    str(Path(__file__).resolve().parents[3] / "infra/contracts/rp-service-call-graph.json"),
)

_graph_cache: Optional[dict[str, Any]] = None


def load_service_call_graph() -> dict[str, Any]:
    global _graph_cache
    if _graph_cache is not None:
        return _graph_cache
    for candidate in _GRAPH_CANDIDATES:
        if candidate and Path(candidate).is_file():
            with open(candidate, "r", encoding="utf-8") as fh:
                _graph_cache = json.load(fh)
                return _graph_cache
    # Fail-closed embedded fallback matching infra/contracts (python-ai callers only).
    _graph_cache = {
        "version": 1,
        "servers": {
            SERVICE_NAME: {
                "allowedCallers": [
                    "api-gateway",
                    "analytics-service",
                    "listings-service",
                    "media-service",
                    "envoy",
                ]
            }
        },
        "healthAndReflectionBypass": True,
    }
    return _graph_cache


def is_health_or_reflection_method(method_path: str) -> bool:
    method = method_path or ""
    return (
        "grpc.health" in method
        or "grpc.reflection" in method
        or "ServerReflection" in method
        or bool(re.search(r"/Health/(Check|Watch)$", method))
    )


def normalize_peer_identity(raw: str) -> str:
    value = (raw or "").strip().lower()
    if value.startswith("dns:"):
        value = value[4:]
    if value.startswith("spiffe://"):
        # spiffe://record-platform.local/ns/record-platform/sa/<service-name>
        parts = value.rstrip("/").split("/")
        if parts:
            return parts[-1]
        return value
    # Strip cluster FQDN suffixes → short service name
    for suffix in (
        ".record-platform.svc.cluster.local",
        ".record-platform.svc",
        ".record-platform",
    ):
        if value.endswith(suffix):
            value = value[: -len(suffix)]
            break
    return value


def identities_from_auth_context(auth_context: dict[Any, Sequence[bytes]]) -> list[str]:
    identities: list[str] = []
    if not auth_context:
        return identities
    # grpc-python commonly exposes these keys as bytes.
    for key in (
        b"x509_subject_alternative_name",
        "x509_subject_alternative_name",
        b"x509_common_name",
        "x509_common_name",
    ):
        values = auth_context.get(key) or ()
        for item in values:
            text = item.decode("utf-8", errors="replace") if isinstance(item, (bytes, bytearray)) else str(item)
            # SAN entries may be "DNS:name" or bare names; CN may be bare.
            for piece in re.split(r"[,;\s]+", text):
                piece = piece.strip()
                if not piece:
                    continue
                if piece.upper().startswith("DNS:") or piece.upper().startswith("URI:"):
                    piece = piece.split(":", 1)[1]
                if piece.upper().startswith("CN="):
                    piece = piece[3:]
                norm = normalize_peer_identity(piece)
                if norm and norm not in identities:
                    identities.append(norm)
    return identities


def authorize_peer(
    *,
    method: str,
    auth_context: dict[Any, Sequence[bytes]],
    service_name: str = SERVICE_NAME,
) -> tuple[bool, str]:
    if os.getenv("RP_MTLS_PEER_AUTH_DISABLE") == "1":
        return True, "disabled"
    graph = load_service_call_graph()
    if graph.get("healthAndReflectionBypass", True) and is_health_or_reflection_method(method):
        return True, "health_bypass"
    server = (graph.get("servers") or {}).get(service_name) or {}
    allowed = [normalize_peer_identity(x) for x in (server.get("allowedCallers") or [])]
    identities = identities_from_auth_context(auth_context)
    if not identities:
        return False, "deny_identity_unavailable"
    for identity in identities:
        if identity in allowed:
            return True, "allow"
    return False, "deny_unauthorized"


def _wrap_unary_unary(method: str, handler: Callable):
    import grpc

    async def wrapped(request, context):
        allowed, reason = authorize_peer(method=method, auth_context=context.auth_context())
        if not allowed:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                f"peer authorization denied ({reason})",
            )
        return await handler(request, context)

    return wrapped


def build_peer_auth_interceptor():
    """Construct the aio interceptor (requires grpc at runtime)."""
    import grpc

    class _PeerAuthInterceptor(grpc.aio.ServerInterceptor):
        """Deny callers whose cert SAN is not in python-ai-service allowedCallers."""

        async def intercept_service(self, continuation, handler_call_details):
            method = getattr(handler_call_details, "method", "") or ""
            handler = await continuation(handler_call_details)
            if handler is None:
                return None
            if handler.unary_unary:
                return grpc.unary_unary_rpc_method_handler(
                    _wrap_unary_unary(method, handler.unary_unary),
                    request_deserializer=handler.request_deserializer,
                    response_serializer=handler.response_serializer,
                )
            if handler.unary_stream:

                async def us(request, context):
                    allowed, reason = authorize_peer(
                        method=method, auth_context=context.auth_context()
                    )
                    if not allowed:
                        await context.abort(
                            grpc.StatusCode.PERMISSION_DENIED,
                            f"peer authorization denied ({reason})",
                        )
                    async for item in handler.unary_stream(request, context):
                        yield item

                return grpc.unary_stream_rpc_method_handler(
                    us,
                    request_deserializer=handler.request_deserializer,
                    response_serializer=handler.response_serializer,
                )
            return handler

    return _PeerAuthInterceptor()


class PeerAuthInterceptor:
    """Lazy factory so unit tests can import helpers without installing grpc."""

    def __new__(cls):
        return build_peer_auth_interceptor()
