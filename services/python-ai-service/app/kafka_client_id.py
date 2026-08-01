"""Canonical Kafka client.id for python-ai-service.

Format: record-platform.<service>.<pod-uid-prefix>.<role>

client.id is attribution only — never an authorization identity.
"""
from __future__ import annotations

import os
import re
from typing import Final

ALLOWED_ROLES: Final[frozenset[str]] = frozenset(
    {
        "producer",
        "consumer",
        "admin",
        "outbox-publisher",
        "lifecycle-consumer",
        "market-event-consumer",
        "notification-consumer",
        "retry-consumer",
        "DLQ-consumer",
        "replay-producer",
        "inference-consumer",
        "result-producer",
        "dlq-producer",
    }
)

_SERVICE_RE = re.compile(r"^[a-zA-Z0-9._-]{1,48}$")
_ROLE_RE = re.compile(r"^[a-zA-Z0-9._-]{1,48}$")
_TOKEN_RE = re.compile(r"^[a-zA-Z0-9]{1,12}$")


def _acceptance_strict() -> bool:
    v = (os.getenv("RP_KAFKA_CLIENT_ID_STRICT") or os.getenv("RP_ACCEPTANCE_MODE") or "").strip()
    return v in ("1", "true", "TRUE")


def _sanitize_service(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "-", (raw or "").strip()).strip("-")[:48]
    return cleaned


def _pod_token(uid_raw: str) -> str:
    uid = (uid_raw or "").replace("-", "").strip()
    return re.sub(r"[^a-zA-Z0-9]", "", uid)[:8]


def resolve_kafka_client_id(
    role: str,
    *,
    service: str | None = None,
    pod_uid: str | None = None,
) -> str:
    """Build a canonical client.id or fail closed in acceptance mode."""
    role_s = (role or "").strip()
    if not role_s or role_s not in ALLOWED_ROLES or not _ROLE_RE.match(role_s):
        raise ValueError(f"invalid kafka client role: {role!r}")

    svc = _sanitize_service(
        service
        or os.getenv("RP_SERVICE_NAME")
        or os.getenv("OTEL_SERVICE_NAME")
        or os.getenv("SERVICE_NAME")
        or ""
    )
    if not svc or not _SERVICE_RE.match(svc):
        if _acceptance_strict():
            raise ValueError("RP_SERVICE_NAME required for kafka client.id in acceptance mode")
        svc = svc or "unknown"

    uid = (pod_uid if pod_uid is not None else (os.getenv("RP_POD_UID") or os.getenv("POD_UID") or "")).strip()
    token = _pod_token(uid)
    if not token or not _TOKEN_RE.match(token):
        if _acceptance_strict():
            raise ValueError("RP_POD_UID/POD_UID required for kafka client.id in acceptance mode")
        # Non-acceptance fallback is still forbidden for library defaults; use explicit local token.
        token = "local"

    client_id = f"record-platform.{svc}.{token}.{role_s}"
    if len(client_id) > 200:
        client_id = client_id[:200]
    if not client_id.startswith("record-platform."):
        raise ValueError("client.id must start with record-platform.")
    if not client_id.endswith(f".{role_s}"):
        raise ValueError("client.id must end with role suffix")
    return client_id
