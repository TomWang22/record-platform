#!/usr/bin/env python3
"""Immutable canary-v3 trace evidence primitives. This module never starts a live window."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlparse

JAEGER_BASE_LOCKED = "https://jaeger.record-platform.test/jaeger"
JAEGER_HOSTNAME_LOCKED = "jaeger.record-platform.test"
METALLB_IP_LOCKED = "192.168.64.245"
_REPO_ROOT = Path(__file__).resolve().parents[2]
RP_DEV_ROOT_CA_PEM = _REPO_ROOT / "certs" / "dev-root.pem"
RP_DEV_INTERMEDIATE_PEM = _REPO_ROOT / "certs" / "dev-intermediate.pem"
POLL_MAX_WALL_SECONDS_DEFAULT = 90
HTTP_TIMEOUT_CAP_DEFAULT = 30.0
BACKOFF_INITIAL_MS = 250
BACKOFF_MAX_MS = 5000
EXPECTED_INVOCATIONS = 30
BATCH_LIMIT = 25
SCHEDULED_INTERVAL_S = 120
AUTH_SCHEMA = "canary-v3-execution-authorization/v1"
STABILITY_SCHEMA = "canary-v3-observability-stability/v1"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256_der(der: bytes) -> str:
    return hashlib.sha256(der).hexdigest()


def _pem_file_der_sha256(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"tls_ca_missing:{path}")
    der = subprocess.check_output(
        ["openssl", "x509", "-in", str(path), "-outform", "DER"],
        stderr=subprocess.DEVNULL,
    )
    return _sha256_der(der)


def build_rp_ssl_context() -> ssl.SSLContext:
    """Trust the Record Platform dev root only — never system/fallback trust alone."""
    if not RP_DEV_ROOT_CA_PEM.is_file():
        raise FileNotFoundError(f"tls_ca_missing:{RP_DEV_ROOT_CA_PEM}")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.check_hostname = True
    ctx.load_verify_locations(cafile=str(RP_DEV_ROOT_CA_PEM))
    return ctx


def inspect_jaeger_query_plane_tls(host: str, port: int) -> dict[str, Any]:
    """Exact TLS verify for the locked Jaeger query hostname.

    Fail closed: verification must be VERIFIED and leaf/intermediate/root
    fingerprints must all be present. No localhost / port-forward path.
    """
    if host != JAEGER_HOSTNAME_LOCKED:
        return {
            "sni_hostname": host,
            "leaf_sha256": None,
            "intermediate_sha256": None,
            "root_sha256": None,
            "certificate_path_verification": "FAILED",
            "error": "sni_hostname_not_locked",
        }

    try:
        ctx = build_rp_ssl_context()
        with socket.create_connection((host, port), timeout=10) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as connection:
                leaf = connection.getpeercert(binary_form=True) or b""
                if not leaf:
                    raise ssl.SSLError("peer_leaf_missing")
                leaf_fp = _sha256_der(leaf)
    except Exception as exc:  # noqa: BLE001
        return {
            "sni_hostname": host,
            "leaf_sha256": None,
            "intermediate_sha256": None,
            "root_sha256": None,
            "certificate_path_verification": "FAILED",
            "error": f"{type(exc).__name__}:{exc}",
        }

    # Peer chain via openssl (leaf + intermediates presented by server).
    try:
        out = subprocess.check_output(
            [
                "openssl",
                "s_client",
                "-connect",
                f"{host}:{port}",
                "-servername",
                host,
                "-showcerts",
            ],
            input=b"",
            stderr=subprocess.STDOUT,
            timeout=15,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "sni_hostname": host,
            "leaf_sha256": leaf_fp,
            "intermediate_sha256": None,
            "root_sha256": None,
            "certificate_path_verification": "FAILED",
            "error": f"chain_capture_failed:{type(exc).__name__}:{exc}",
        }

    chain_fps: list[str] = []
    current: list[str] = []
    for line in out.decode(errors="ignore").splitlines():
        if "BEGIN CERTIFICATE" in line:
            current = [line]
        elif current:
            current.append(line)
            if "END CERTIFICATE" in line:
                pem = ("\n".join(current) + "\n").encode()
                der = subprocess.check_output(
                    ["openssl", "x509", "-outform", "DER"],
                    input=pem,
                    stderr=subprocess.DEVNULL,
                )
                chain_fps.append(_sha256_der(der))
                current = []

    intermediate_fp = chain_fps[1] if len(chain_fps) >= 2 else None
    try:
        root_fp = _pem_file_der_sha256(RP_DEV_ROOT_CA_PEM)
    except Exception as exc:  # noqa: BLE001
        return {
            "sni_hostname": host,
            "leaf_sha256": leaf_fp,
            "intermediate_sha256": intermediate_fp,
            "root_sha256": None,
            "certificate_path_verification": "FAILED",
            "error": f"root_fingerprint_failed:{type(exc).__name__}:{exc}",
        }

    if not leaf_fp or not intermediate_fp or not root_fp:
        return {
            "sni_hostname": host,
            "leaf_sha256": leaf_fp,
            "intermediate_sha256": intermediate_fp,
            "root_sha256": root_fp,
            "certificate_path_verification": "FAILED",
            "error": "fingerprint_missing",
        }

    return {
        "sni_hostname": host,
        "leaf_sha256": leaf_fp,
        "intermediate_sha256": intermediate_fp,
        "root_sha256": root_fp,
        "certificate_path_verification": "VERIFIED",
        "error": None,
    }


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def atomic_create_only_bytes(path: Path | str, content: bytes) -> Path:
    """Durably create path through a same-directory temp and no-replace hard link."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, destination)
        directory_fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def atomic_create_only_text(path: Path | str, content: str) -> Path:
    return atomic_create_only_bytes(path, content.encode())


def atomic_create_only_json(path: Path | str, content: Any) -> Path:
    return atomic_create_only_bytes(path, _json_bytes(content))


def assert_locked_jaeger_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.hostname != JAEGER_HOSTNAME_LOCKED:
        raise ValueError(f"jaeger_hostname_not_locked:{parsed.hostname}")
    if url != JAEGER_BASE_LOCKED and not url.startswith(f"{JAEGER_BASE_LOCKED}/"):
        raise ValueError(f"jaeger_base_not_locked:{url}")


def _json_content_type(content_type: str | None) -> bool:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    return media_type == "application/json" or (
        media_type.startswith("application/") and media_type.endswith("+json")
    )


def evaluate_exact_trace_success(
    *,
    requested_trace_id: str,
    http_status: int | None,
    body: bytes | None,
    content_type: str | None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "requested_trace_id": requested_trace_id,
        "http_status": http_status,
        "content_type": content_type,
        "content_type_json": _json_content_type(content_type),
        "bytes": len(body) if body is not None else 0,
        "sha256": hashlib.sha256(body).hexdigest() if body is not None else None,
        "json_parse_ok": False,
        "json_parse_error": None,
        "data_length": 0,
        "returned_trace_id": None,
        "trace_id_match": False,
        "span_count": 0,
        "queryable": False,
        "exact_success": False,
    }
    if http_status != 200:
        result["failure_reason"] = "http_status_not_200"
        return result
    if not result["content_type_json"]:
        result["failure_reason"] = "content_type_not_json"
        return result
    if body is None:
        result["failure_reason"] = "empty_body"
        return result
    try:
        document = json.loads(body)
        result["json_parse_ok"] = True
    except Exception as exc:  # noqa: BLE001
        result["json_parse_error"] = f"{type(exc).__name__}:{exc}"
        result["failure_reason"] = "json_parse_failed"
        return result
    traces = document.get("data") if isinstance(document, dict) else None
    if not isinstance(traces, list):
        result["failure_reason"] = "data_not_list"
        return result
    result["data_length"] = len(traces)
    if not traces:
        result["failure_reason"] = "data_length_zero"
        return result
    trace = traces[0] if isinstance(traces[0], dict) else {}
    returned = trace.get("traceID")
    spans = trace.get("spans") if isinstance(trace.get("spans"), list) else []
    result.update(
        returned_trace_id=returned,
        trace_id_match=returned == requested_trace_id,
        span_count=len(spans),
    )
    if not result["trace_id_match"]:
        result["failure_reason"] = "returned_trace_id_mismatch"
    elif not spans:
        result["failure_reason"] = "no_spans"
    else:
        result.update(queryable=True, exact_success=True)
    return result


FetchFn = Callable[[str, float], Mapping[str, Any]]


def default_http_fetch(
    url: str,
    timeout_s: float,
    *,
    ssl_context: ssl.SSLContext | None = None,
) -> dict[str, Any]:
    assert_locked_jaeger_url(url)
    started = time.perf_counter()
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        ctx = ssl_context if ssl_context is not None else build_rp_ssl_context()
        with urllib.request.urlopen(request, context=ctx, timeout=timeout_s) as response:
            return {
                "http_status": int(response.status),
                "body": response.read(),
                "content_type": response.headers.get("Content-Type"),
                "error": None,
                "query_duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "localhost_used": False,
                "port_forward_used": False,
                "fallback_used": False,
            }
    except urllib.error.HTTPError as exc:
        return {
            "http_status": int(exc.code),
            "body": exc.read(),
            "content_type": exc.headers.get("Content-Type") if exc.headers else None,
            "error": f"HTTPError:{exc}",
            "query_duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "localhost_used": False,
            "port_forward_used": False,
            "fallback_used": False,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "http_status": None,
            "body": None,
            "content_type": None,
            "error": f"{type(exc).__name__}:{exc}",
            "query_duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "localhost_used": False,
            "port_forward_used": False,
            "fallback_used": False,
        }


def poll_exact_trace(
    *,
    invocation_id: str,
    requested_trace_id: str,
    dest_dir: Path,
    query_plane_preflight_sha256: str,
    max_wall_seconds: float = POLL_MAX_WALL_SECONDS_DEFAULT,
    http_timeout_cap: float = HTTP_TIMEOUT_CAP_DEFAULT,
    fetch_fn: FetchFn | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    monotonic_fn: Callable[[], float] = time.monotonic,
    utc_fn: Callable[[], str] = utc_now,
    rng: random.Random | None = None,
    ssl_context: ssl.SSLContext | None = None,
) -> dict[str, Any]:
    if (
        not invocation_id
        or not requested_trace_id
        or requested_trace_id == "NOT_INSTRUMENTED"
        or not query_plane_preflight_sha256
    ):
        raise ValueError("missing_invocation_or_trace_id")
    destination = Path(dest_dir)
    if destination.exists() and any(destination.iterdir()):
        raise FileExistsError(f"non_empty_poll_destination:{destination}")
    destination.mkdir(parents=True, exist_ok=True)
    attempts_dir = destination / "attempts"
    attempts_dir.mkdir()
    url = f"{JAEGER_BASE_LOCKED}/api/traces/{requested_trace_id}"
    assert_locked_jaeger_url(url)
    fetch = fetch_fn or (
        lambda request_url, timeout_s: default_http_fetch(
            request_url, timeout_s, ssl_context=ssl_context
        )
    )
    random_source = rng or random.Random()
    started = monotonic_fn()
    deadline = started + max_wall_seconds
    attempts: list[dict[str, Any]] = []
    first_success_index: int | None = None
    first_success_sha256: str | None = None
    final_failure: str | None = None
    attempt_index = 0
    while monotonic_fn() < deadline:
        attempt_started = monotonic_fn()
        remaining = deadline - attempt_started
        if remaining <= 0:
            break
        request_timeout = min(http_timeout_cap, remaining)
        attempt_started_utc = utc_fn()
        raw = dict(fetch(url, request_timeout))
        completed = monotonic_fn()
        attempt_completed_utc = utc_fn()
        body_value = raw.get("body")
        body = body_value.encode() if isinstance(body_value, str) else body_value
        if not isinstance(body, (bytes, bytearray)):
            body = b""
        evaluation = evaluate_exact_trace_success(
            requested_trace_id=requested_trace_id,
            http_status=raw.get("http_status"),
            body=bytes(body),
            content_type=raw.get("content_type"),
        )
        exceeded = completed > deadline
        if exceeded:
            evaluation["exact_success"] = False
            evaluation["queryable"] = False
            evaluation["failure_reason"] = "wall_clock_exceeded"
            final_failure = "wall_clock_exceeded"
        meta = {
            "attempt_index": attempt_index,
            "invocation_id": invocation_id,
            "query_plane_preflight_sha256": query_plane_preflight_sha256,
            "url": url,
            "attempt_started_at_utc": attempt_started_utc,
            "attempt_completed_at_utc": attempt_completed_utc,
            "attempt_started_elapsed_ms": round((attempt_started - started) * 1000, 2),
            "attempt_completed_elapsed_ms": round((completed - started) * 1000, 2),
            "request_timeout_s": request_timeout,
            "wall_clock_exceeded": exceeded,
            "http_status": raw.get("http_status"),
            "error": raw.get("error"),
            "query_duration_ms": raw.get("query_duration_ms"),
            "localhost_used": bool(raw.get("localhost_used", False)),
            "port_forward_used": bool(raw.get("port_forward_used", False)),
            "fallback_used": bool(raw.get("fallback_used", False)),
            **evaluation,
        }
        if meta["localhost_used"] or meta["port_forward_used"] or meta["fallback_used"]:
            raise ValueError("forbidden_fallback_path_used")
        stem = f"{attempt_index:03d}"
        body_path = attempts_dir / f"{stem}.json"
        atomic_create_only_bytes(body_path, bytes(body))
        atomic_create_only_json(attempts_dir / f"{stem}.meta.json", meta)
        attempts.append(meta)
        if evaluation["exact_success"]:
            first_success_index = attempt_index
            source_hash = hashlib.sha256(body_path.read_bytes()).hexdigest()
            atomic_create_only_bytes(destination / "first_success.json", body_path.read_bytes())
            copied_hash = hashlib.sha256((destination / "first_success.json").read_bytes()).hexdigest()
            if copied_hash != source_hash:
                raise RuntimeError("first_success_hash_mismatch_after_copy")
            first_success_sha256 = copied_hash
            atomic_create_only_json(
                destination / "first_success.meta.json",
                {
                    **meta,
                    "copied_from_attempt_index": attempt_index,
                    "first_success_body_source": "EXISTING_SUCCESSFUL_ATTEMPT_BODY",
                    "first_success_requery_allowed": False,
                    "source_attempt_sha256": source_hash,
                    "first_success_sha256": copied_hash,
                    "source_hash_verified": True,
                },
            )
            break
        if exceeded:
            break
        attempt_index += 1
        remaining = deadline - monotonic_fn()
        if remaining <= 0:
            break
        delay_ms = min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * (2 ** (attempt_index - 1)))
        jittered = max(1, int(delay_ms * random_source.uniform(0.8, 1.2))) / 1000
        sleep_fn(min(jittered, remaining))
    final = {
        "invocation_id": invocation_id,
        "requested_trace_id": requested_trace_id,
        "query_plane_preflight_sha256": query_plane_preflight_sha256,
        "url": url,
        "poll_max_wall_seconds": max_wall_seconds,
        "http_timeout_cap": http_timeout_cap,
        "attempt_count": len(attempts),
        "first_success_attempt_index": first_success_index,
        "first_success_sha256": first_success_sha256,
        "trace_queryable_at_capture": first_success_index is not None,
        "requested_trace_id_equals_response_trace_id": first_success_index is not None,
        "first_success_body_source": (
            "EXISTING_SUCCESSFUL_ATTEMPT_BODY" if first_success_index is not None else None
        ),
        "first_success_requery_allowed": False,
        "failure_reason": final_failure or (
            None if first_success_index is not None else "trace_not_found_before_deadline"
        ),
        "localhost_query_count": 0,
        "port_forward_query_count": 0,
        "fallback_query_count": 0,
        "attempts": attempts,
    }
    atomic_create_only_json(destination / "final.meta.json", final)
    return final


poll_exact_trace.is_production_adapter = True


@dataclass(frozen=True)
class QueryPlanePin:
    leaf_sha256: str
    intermediate_sha256: str
    root_sha256: str

    def __post_init__(self) -> None:
        if not self.leaf_sha256 or not self.intermediate_sha256 or not self.root_sha256:
            raise ValueError("query_plane_pin_requires_three_fingerprints")


def build_query_plane_preflight(
    *,
    pin: QueryPlanePin,
    resolve_fn: Callable[[str], list[str]] | None = None,
    tls_inspect_fn: Callable[[str, int], Mapping[str, Any]] | None = None,
    api_health_fn: Callable[[], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    resolve = resolve_fn or (
        lambda host: sorted(
            {record[4][0] for record in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
        )
    )
    dns_ips = resolve(JAEGER_HOSTNAME_LOCKED)
    stage1_pass = dns_ips.count(METALLB_IP_LOCKED) == 1

    tls = dict((tls_inspect_fn or inspect_jaeger_query_plane_tls)(JAEGER_HOSTNAME_LOCKED, 443))
    fingerprint_matches = {
        "leaf": tls.get("leaf_sha256") == pin.leaf_sha256,
        "intermediate": tls.get("intermediate_sha256") == pin.intermediate_sha256,
        "root": tls.get("root_sha256") == pin.root_sha256,
    }
    fingerprints_present = all(
        bool(tls.get(key)) and not str(tls.get(key)).startswith("UNSET")
        for key in ("leaf_sha256", "intermediate_sha256", "root_sha256")
    )
    stage2_pass = (
        tls.get("sni_hostname") == JAEGER_HOSTNAME_LOCKED
        and tls.get("certificate_path_verification") == "VERIFIED"
        and fingerprints_present
        and all(fingerprint_matches.values())
    )
    if api_health_fn:
        health = dict(api_health_fn())
    else:
        response = default_http_fetch(f"{JAEGER_BASE_LOCKED}/api/services", 15)
        health = {
            "http_status": response.get("http_status"),
            "ok": response.get("http_status") == 200,
            "error": response.get("error"),
        }
    stage3_pass = health.get("ok") is True
    stages = {
        "stage1_dns": {
            "status": "PASS" if stage1_pass else "FAIL",
            "hostname": JAEGER_HOSTNAME_LOCKED,
            "resolved_ips": dns_ips,
            "required_metallb_ip": METALLB_IP_LOCKED,
        },
        "stage2_tls": {
            "status": "PASS" if stage2_pass else "FAIL",
            "pin": asdict(pin),
            "observed": tls,
            "fingerprint_matches": fingerprint_matches,
        },
        "stage3_api_health": {
            "status": "PASS" if stage3_pass else "FAIL",
            "health": health,
        },
    }
    overall = stage1_pass and stage2_pass and stage3_pass
    return {
        "status": "PASS" if overall else "PARTIAL",
        "pass": overall,
        "jaeger_base": JAEGER_BASE_LOCKED,
        "stages": stages,
        "captured_at_utc": utc_now(),
        "localhost_query_count": 0,
        "port_forward_query_count": 0,
        "fallback_query_count": 0,
    }


@dataclass
class WorkloadSnapshot:
    jaeger_ready: bool
    jaeger_storage_ready: bool
    jaeger_restart_count: int
    jaeger_oomkill_count: int
    otel_collector_restart_count: int


def _parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp_must_be_timezone_aware")
    return parsed


def evaluate_observability_stability_gate(
    *,
    baseline: WorkloadSnapshot | Mapping[str, Any],
    current: WorkloadSnapshot | Mapping[str, Any],
    baseline_captured_at_utc: str,
    current_captured_at_utc: str,
    metallb_query_tls_preflight_pass: bool = True,
    control_trace_round_trip_pass: bool = True,
    memory_store_retention_risk_acknowledged: bool = True,
    window_seconds: int = 3600,
    margin_seconds: int = 600,
) -> dict[str, Any]:
    def value(snapshot: WorkloadSnapshot | Mapping[str, Any], key: str) -> Any:
        return getattr(snapshot, key) if isinstance(snapshot, WorkloadSnapshot) else snapshot[key]

    observed = (_parse_utc(current_captured_at_utc) - _parse_utc(baseline_captured_at_utc)).total_seconds()
    required = window_seconds + margin_seconds
    gate = {
        "baseline_captured_at_utc": baseline_captured_at_utc,
        "current_captured_at_utc": current_captured_at_utc,
        "observed_stability_seconds": observed,
        "stability_window_seconds_required": required,
        "observed_stability_seconds_ok": observed >= required,
        "jaeger_query_ready": bool(value(current, "jaeger_ready")),
        "jaeger_storage_ready": bool(value(current, "jaeger_storage_ready")),
        "jaeger_restart_growth": int(value(current, "jaeger_restart_count"))
        - int(value(baseline, "jaeger_restart_count")),
        "jaeger_oomkill_growth": int(value(current, "jaeger_oomkill_count"))
        - int(value(baseline, "jaeger_oomkill_count")),
        "otel_collector_restart_growth": int(value(current, "otel_collector_restart_count"))
        - int(value(baseline, "otel_collector_restart_count")),
        "metallb_query_tls_preflight": "PASS" if metallb_query_tls_preflight_pass else "FAIL",
        "control_trace_round_trip": "PASS" if control_trace_round_trip_pass else "FAIL",
        "memory_store_retention_risk_acknowledged": memory_store_retention_risk_acknowledged,
        "capture_time_freeze_authoritative": True,
    }
    gate["pass"] = (
        gate["observed_stability_seconds_ok"]
        and gate["jaeger_query_ready"]
        and gate["jaeger_storage_ready"]
        and gate["jaeger_restart_growth"] == 0
        and gate["jaeger_oomkill_growth"] == 0
        and gate["otel_collector_restart_growth"] == 0
        and gate["metallb_query_tls_preflight"] == "PASS"
        and gate["control_trace_round_trip"] == "PASS"
        and gate["memory_store_retention_risk_acknowledged"] is True
    )
    return gate


def load_frozen_report(path: Path | str, required_status: str, required_schema: str) -> dict[str, Any]:
    report_path = Path(path)
    raw = report_path.read_bytes()
    sidecars = [Path(f"{report_path}.sha256"), report_path.with_suffix(".sha256")]
    sidecar = next((candidate for candidate in sidecars if candidate.exists()), None)
    digest = hashlib.sha256(raw).hexdigest()
    if sidecar:
        expected = sidecar.read_text().strip().split()[0]
        if expected != digest:
            raise ValueError(f"frozen_report_sha256_mismatch:{report_path}")
    report = json.loads(raw)
    if report.get("schema") != required_schema:
        raise ValueError(f"frozen_report_schema_mismatch:{report_path}")
    if report.get("status") != required_status:
        raise ValueError(f"frozen_report_status_mismatch:{report_path}")
    report["_frozen_sha256"] = digest
    report["_sha256_sidecar_verified"] = sidecar is not None
    return report


def evaluate_execution_authorization_from_reports(
    authorization_report_path: Path | str,
    stability_report_path: Path | str,
    expected_runtime_sha: str,
) -> dict[str, Any]:
    try:
        authorization = load_frozen_report(authorization_report_path, "AUTHORIZED", AUTH_SCHEMA)
        stability = load_frozen_report(stability_report_path, "PASS", STABILITY_SCHEMA)
        runtime_ok = (
            bool(expected_runtime_sha)
            and authorization.get("expected_runtime_sha") == expected_runtime_sha
            and stability.get("expected_runtime_sha") == expected_runtime_sha
        )
        stability_gate = stability.get("gate") if isinstance(stability.get("gate"), dict) else {}
        stability_ok = (
            stability_gate.get("pass") is True
            and stability_gate.get("observed_stability_seconds_ok") is True
        )
        allowed = runtime_ok and stability_ok
        return {
            "may_execute_window": allowed,
            "status": "AUTHORIZED" if allowed else "EXECUTION_REFUSED",
            "runtime_sha_match": runtime_ok,
            "stability_gate_valid": stability_ok,
            "authorization_report": authorization,
            "stability_report": stability,
        }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {
            "may_execute_window": False,
            "status": "EXECUTION_REFUSED",
            "reason": f"{type(exc).__name__}:{exc}",
        }


def evaluate_root_reuse_policy(root: Path | str, writer_id: str) -> dict[str, Any]:
    path = Path(root)
    if not path.exists():
        return {"allowed": True, "reason": "EMPTY_ROOT_NEW_RUN", "writer_id": writer_id}
    if (path / "CANARY_DONE").exists():
        return {"allowed": False, "reason": "CANARY_DONE_ROOT_NOT_REUSABLE"}
    if (path / "CANARY_INCOMPLETE").exists():
        return {"allowed": False, "reason": "CANARY_INCOMPLETE_ROOT_NOT_REUSABLE"}
    return {"allowed": False, "reason": "ABANDONED_PARTIAL_ROOT_NOT_REUSABLE"}


def assert_owner(root: Path | str, owner_token: str) -> dict[str, Any]:
    path = Path(root)
    try:
        lock = json.loads((path / "writer.lock.json").read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise PermissionError(f"root_owner_lock_invalid:{exc}") from exc
    if not owner_token or lock.get("owner_token") != owner_token:
        raise PermissionError("root_owner_token_mismatch")
    return lock


def close_root_lease(root: Path | str, owner_token: str, state: str) -> None:
    if state not in {"DONE", "INCOMPLETE"}:
        raise ValueError("invalid_terminal_lease_state")
    path = Path(root)
    assert_owner(path, owner_token)
    terminal = {
        "state": state,
        "closed_at_utc": utc_now(),
        "owner_token": owner_token,
    }
    atomic_create_only_json(path / "lease" / "TERMINAL.json", terminal)
    atomic_create_only_json(
        path / "writer.lease_closed.json",
        {"owner_token": owner_token, "state": state, "closed_at_utc": terminal["closed_at_utc"]},
    )


def mark_root_incomplete(
    root: Path | str, reason: str, missing: list[str], *, owner_token: str
) -> Path:
    path = Path(root)
    assert_owner(path, owner_token)
    if (path / "CANARY_DONE").exists():
        raise FileExistsError("cannot_mark_done_root_incomplete")
    return atomic_create_only_json(
        path / "CANARY_INCOMPLETE",
        {
            "status": "INCOMPLETE",
            "reason": reason,
            "missing_trace_invocation_ids": missing,
            "retry_into_pass_forbidden": True,
            "marked_at_utc": utc_now(),
        },
    )


def validate_invocation_denominator(records: list[Mapping[str, Any]]) -> dict[str, Any]:
    raise RuntimeError("records-list denominator removed; use validate_invocation_denominator_from_root")


def validate_invocation_denominator_from_root(root: Path | str) -> dict[str, Any]:
    path = Path(root)
    errors: list[str] = []
    try:
        manifest = json.loads((path / "invocation-manifest.json").read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return {"pass": False, "errors": [f"invalid_invocation_manifest:{exc}"]}
    entries = manifest.get("invocation_ids")
    if not isinstance(entries, list):
        entries = manifest.get("invocations")
    if isinstance(entries, list) and entries and isinstance(entries[0], dict):
        ids = [entry.get("invocation_id") for entry in entries]
    else:
        ids = entries if isinstance(entries, list) else []
    if len(ids) != EXPECTED_INVOCATIONS:
        errors.append(f"manifest_invocation_count:{len(ids)}")
    if any(not isinstance(item, str) or not item for item in ids):
        errors.append("manifest_missing_or_null_invocation_id")
    if len(set(ids)) != len(ids):
        errors.append("manifest_duplicate_invocation_ids")
    finals = list((path / "traces").glob("*/final.meta.json"))
    if len(finals) != EXPECTED_INVOCATIONS:
        errors.append(f"final_count:{len(finals)}")
    seen_trace_ids: list[str] = []
    exact_matches = 0
    for final_path in finals:
        invocation_id = final_path.parent.name
        if invocation_id not in ids:
            errors.append(f"final_outside_manifest:{invocation_id}")
        try:
            final = json.loads(final_path.read_text())
        except json.JSONDecodeError:
            errors.append(f"invalid_final:{invocation_id}")
            continue
        if final.get("invocation_id") != invocation_id:
            errors.append(f"final_invocation_id_mismatch:{invocation_id}")
        trace_id = final.get("requested_trace_id")
        if not trace_id:
            errors.append(f"missing_trace_id:{invocation_id}")
        else:
            seen_trace_ids.append(trace_id)
        if final.get("url") != f"{JAEGER_BASE_LOCKED}/api/traces/{trace_id}":
            errors.append(f"url_mismatch:{invocation_id}")
        if any(int(final.get(key, 0) or 0) > 0 for key in (
            "localhost_query_count", "port_forward_query_count", "fallback_query_count"
        )):
            errors.append(f"fallback_counter_nonzero:{invocation_id}")
        index = final.get("first_success_attempt_index")
        if not isinstance(index, int):
            errors.append(f"missing_first_success:{invocation_id}")
            continue
        try:
            attempt = json.loads((final_path.parent / "attempts" / f"{index:03d}.meta.json").read_text())
            source_body = (final_path.parent / "attempts" / f"{index:03d}.json").read_bytes()
            first_body = (final_path.parent / "first_success.json").read_bytes()
        except OSError:
            errors.append(f"missing_first_success_artifact:{invocation_id}")
            continue
        source_hash = hashlib.sha256(source_body).hexdigest()
        first_hash = hashlib.sha256(first_body).hexdigest()
        if source_hash != attempt.get("sha256") or first_hash != source_hash:
            errors.append(f"first_success_hash_mismatch:{invocation_id}")
        if (
            attempt.get("exact_success") is True
            and attempt.get("requested_trace_id") == trace_id
            and attempt.get("returned_trace_id") == trace_id
        ):
            exact_matches += 1
        else:
            errors.append(f"frozen_attempt_not_exact:{invocation_id}")
    if len(seen_trace_ids) != len(set(seen_trace_ids)):
        errors.append("duplicate_trace_ids")
    return {
        "pass": not errors,
        "errors": errors,
        "invocations_observed": len(finals),
        "requested_trace_id_equals_response_trace_id": f"{exact_matches}/{EXPECTED_INVOCATIONS}",
        "unique_invocation_ids": f"{len(set(ids))}/{EXPECTED_INVOCATIONS}",
        "unique_trace_ids": f"{len(set(seen_trace_ids))}/{EXPECTED_INVOCATIONS}",
    }


def cli_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    fixture = json.loads(Path(args.fixture).read_text())
    if args.action == "evaluate_exact_trace_success":
        value = fixture.get("body")
        result = evaluate_exact_trace_success(
            requested_trace_id=fixture["requested_trace_id"],
            http_status=fixture.get("http_status"),
            body=value.encode() if isinstance(value, str) else value,
            content_type=fixture.get("content_type"),
        )
    elif args.action == "poll_exact_trace":
        sequence = fixture["fetch_sequence"]
        calls = {"count": 0}
        clock = {"value": 0.0}
        advances = fixture.get("fetch_advance_seconds", [])

        def fetch(_url: str, _timeout_s: float) -> dict[str, Any]:
            index = calls["count"]
            calls["count"] += 1
            if index < len(advances):
                clock["value"] += advances[index]
            item = dict(sequence[min(index, len(sequence) - 1)])
            if isinstance(item.get("body"), str):
                item["body"] = item["body"].encode()
            return item

        def sleep(seconds: float) -> None:
            clock["value"] += seconds

        result = poll_exact_trace(
            invocation_id=fixture["invocation_id"],
            requested_trace_id=fixture["requested_trace_id"],
            dest_dir=Path(fixture["dest_dir"]),
            query_plane_preflight_sha256=fixture.get(
                "query_plane_preflight_sha256", "fixture-preflight-sha256"
            ),
            max_wall_seconds=float(fixture.get("max_wall_seconds", 90)),
            fetch_fn=fetch,
            sleep_fn=sleep,
            monotonic_fn=lambda: clock["value"],
            utc_fn=lambda: "2026-08-06T12:00:00Z",
            rng=random.Random(0),
        )
        result["fetch_call_count"] = calls["count"]
    elif args.action == "observability_stability":
        result = evaluate_observability_stability_gate(**fixture)
    elif args.action == "query_plane_preflight":
        result = build_query_plane_preflight(
            pin=QueryPlanePin(**fixture["pin"]),
            resolve_fn=lambda _host: fixture["dns"],
            tls_inspect_fn=lambda _host, _port: fixture["tls"],
            api_health_fn=lambda: fixture["api_health"],
        )
    elif args.action == "atomic_create_only":
        path = Path(fixture["path"])
        atomic_create_only_json(path, {"sealed": 1})
        refused = False
        try:
            atomic_create_only_json(path, {"sealed": 2})
        except FileExistsError:
            refused = True
        result = {"first_write": path.exists(), "second_write_refused": refused}
    elif args.action == "immutable_root":
        root = Path(fixture["root"])
        root.mkdir(parents=True, exist_ok=True)
        for index in range(int(fixture.get("seed_final_count", 0))):
            final = root / "traces" / f"inv-{index}" / "final.meta.json"
            final.parent.mkdir(parents=True)
            final.write_text("{}")
        result = evaluate_root_reuse_policy(root, fixture["writer_id"])
    elif args.action == "execution_gate":
        result = evaluate_execution_authorization_from_reports(**fixture)
    elif args.action == "denominator_from_root":
        result = validate_invocation_denominator_from_root(fixture["root"])
    else:
        raise SystemExit(f"unknown_action:{args.action}")
    output = json.dumps(result, indent=2) + "\n"
    if args.out:
        Path(args.out).write_text(output)
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(cli_main())
