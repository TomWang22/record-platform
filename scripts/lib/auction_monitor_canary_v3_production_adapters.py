#!/usr/bin/env python3
"""
Production adapters for canary-v3 live execution.

Wired and hash-bound. Read-only live capture implementations are enabled in code
and may be exercised under allow_readonly_probe without authorizing the window.
Window cluster I/O still requires an AUTHORIZED packet plus allow_cluster_io.
Fixture adapters must never be accepted on the live path.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Mapping

from auction_monitor_canary_v3_live_capture import (
    LIVE_CAPTURE_ACCEPTANCE_READY,
    LiveReadonlyCaptureSession,
    capture_leader_snapshot,
    capture_publisher_log_cursor_readonly,
    default_command_runner,
    docker_execution_plane_as_dict,
    scrape_auction_monitor_prometheus,
    validate_live_a1_counters_from_prometheus,
)
from auction_monitor_canary_v3_trace import (
    BATCH_LIMIT,
    EXPECTED_INVOCATIONS,
    JAEGER_BASE_LOCKED,
    JAEGER_HOSTNAME_LOCKED,
    METALLB_IP_LOCKED,
    SCHEDULED_INTERVAL_S,
    QueryPlanePin,
    build_query_plane_preflight,
    poll_exact_trace,
    utc_now,
)

LIB_DIR = Path(__file__).resolve().parent
REPO = LIB_DIR.parents[1]

LIVE_WINDOW_PACKET_SCHEMA = "canary-v3-live-window-authorization-packet/v1"
ADAPTER_HASH_KEYS = (
    "production_adapters_module",
    "live_capture_module",
    "orchestrator_module",
    "trace_lib_module",
    "final_root_auditor",
    "runner_module",
)

# Code-complete flag: read-only capture paths exist and are tested.
LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED = True
# Acceptance-ready remains false until fail-closed regression blockers are closed.
# Re-export module constant for runners/tests.
# LIVE_CAPTURE_ACCEPTANCE_READY imported from live_capture module.
# Window arm flag: remains false until AUTHORIZED packet + explicit owner arm.
LIVE_CAPTURE_ARMED_FOR_WINDOW = False


def production_adapter(fn: Callable[..., Any]) -> Callable[..., Any]:
    setattr(fn, "is_production_adapter", True)
    setattr(fn, "is_fixture_adapter", False)
    return fn


def wrap_production_hook(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Return a free function that preserves production-adapter markers for hook policy."""

    @production_adapter
    def _hook(*args: Any, **kwargs: Any) -> Any:
        return fn(*args, **kwargs)

    _hook.__name__ = getattr(fn, "__name__", _hook.__name__)
    _hook.__qualname__ = getattr(fn, "__qualname__", _hook.__qualname__)
    return _hook


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_production_adapter_source_hashes(repo: Path | None = None) -> dict[str, str]:
    root = Path(repo or REPO)
    paths = {
        "production_adapters_module": root / "scripts/lib/auction_monitor_canary_v3_production_adapters.py",
        "live_capture_module": root / "scripts/lib/auction_monitor_canary_v3_live_capture.py",
        "orchestrator_module": root / "scripts/lib/auction_monitor_canary_v3_orchestrator.py",
        "trace_lib_module": root / "scripts/lib/auction_monitor_canary_v3_trace.py",
        "final_root_auditor": root / "scripts/audit-auction-monitor-canary-v3-final-root.py",
        "runner_module": root / "scripts/run-auction-monitor-broker-ack-canary-v3.py",
    }
    return {key: _file_sha256(path) for key, path in paths.items()}


def load_live_window_authorization_packet(path: Path | str) -> dict[str, Any]:
    packet_path = Path(path)
    raw = packet_path.read_bytes()
    digest = sha256_bytes(raw)
    sidecar = Path(f"{packet_path}.sha256")
    if sidecar.exists():
        expected = sidecar.read_text().strip().split()[0]
        if expected != digest:
            raise ValueError(f"live_window_packet_sha256_mismatch:{packet_path}")
    packet = json.loads(raw)
    if packet.get("schema") != LIVE_WINDOW_PACKET_SCHEMA:
        raise ValueError("live_window_packet_schema_mismatch")
    packet["_packet_sha256"] = digest
    packet["_packet_path"] = str(packet_path)
    return packet


def validate_live_window_authorization_packet(
    packet: Mapping[str, Any],
    *,
    expected_runtime_sha: str,
    query_plane_pin: QueryPlanePin,
    require_authorized: bool = True,
    repo: Path | None = None,
) -> dict[str, Any]:
    failures: list[str] = []
    status = packet.get("status")
    if require_authorized and status != "AUTHORIZED":
        failures.append(f"packet_status_not_authorized:{status}")
    if packet.get("live_window_authorized") is not True and require_authorized:
        failures.append("live_window_authorized_flag_false")
    if packet.get("expected_runtime_sha") != expected_runtime_sha:
        failures.append("runtime_sha_mismatch")
    throughput = packet.get("throughput_pin") or {}
    expected_throughput = {
        "batch": BATCH_LIMIT,
        "interval_seconds": SCHEDULED_INTERVAL_S,
        "invocations": EXPECTED_INVOCATIONS,
    }
    if throughput != expected_throughput:
        failures.append("throughput_pin_mismatch")
    pin = packet.get("query_plane_pin") or {}
    expected_pin = {
        "hostname": JAEGER_HOSTNAME_LOCKED,
        "metallb_ip": METALLB_IP_LOCKED,
        "jaeger_base": JAEGER_BASE_LOCKED,
        "leaf_sha256": query_plane_pin.leaf_sha256,
        "intermediate_sha256": query_plane_pin.intermediate_sha256,
        "root_sha256": query_plane_pin.root_sha256,
    }
    for key, value in expected_pin.items():
        if pin.get(key) != value:
            failures.append(f"query_plane_pin_mismatch:{key}")
    computed = compute_production_adapter_source_hashes(repo)
    frozen_hashes = packet.get("adapter_source_hashes") or {}
    for key in ADAPTER_HASH_KEYS:
        if frozen_hashes.get(key) != computed.get(key):
            failures.append(f"adapter_source_hash_mismatch:{key}")
    rollback = packet.get("rollback_conditions")
    if not isinstance(rollback, list) or not rollback:
        failures.append("rollback_conditions_missing")
    return {
        "pass": not failures,
        "failures": failures,
        "computed_adapter_source_hashes": computed,
        "packet_status": status,
        "require_authorized": require_authorized,
    }


class ProductionClusterIoForbidden(RuntimeError):
    """Raised when a production adapter would touch the cluster without authorization."""


class ProductionAdapterBundle:
    """Live adapters with read-only capture implementations.

    Window execution still requires AUTHORIZED + allow_cluster_io.
    Read-only probes may use allow_readonly_probe under a PREPARED packet.
    """

    is_production_adapter = True
    is_fixture_adapter = False

    def __init__(
        self,
        *,
        live_window_packet_path: Path | str,
        expected_runtime_sha: str,
        query_plane_pin: QueryPlanePin,
        allow_cluster_io: bool = False,
        allow_readonly_probe: bool = False,
        live_capture_implementations_enabled: bool = LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED,
        require_packet_authorized: bool = True,
        command_runner: Callable[..., str] | None = None,
        repo: Path | None = None,
    ) -> None:
        self.live_window_packet_path = Path(live_window_packet_path)
        self.expected_runtime_sha = expected_runtime_sha
        self.query_plane_pin = query_plane_pin
        self.allow_cluster_io = allow_cluster_io
        self.allow_readonly_probe = allow_readonly_probe
        self.live_capture_implementations_enabled = live_capture_implementations_enabled
        self.require_packet_authorized = require_packet_authorized
        self.repo = Path(repo or REPO)
        self.packet = load_live_window_authorization_packet(self.live_window_packet_path)
        self.packet_validation = validate_live_window_authorization_packet(
            self.packet,
            expected_runtime_sha=expected_runtime_sha,
            query_plane_pin=query_plane_pin,
            require_authorized=require_packet_authorized,
            repo=self.repo,
        )
        if not self.packet_validation["pass"]:
            raise RuntimeError(
                "live_window_authorization_packet_rejected:"
                + ",".join(self.packet_validation["failures"])
            )
        runner = command_runner if command_runner is not None else default_command_runner
        self.capture = LiveReadonlyCaptureSession(
            runner=runner,
            utc_now_fn=utc_now,
            batch_limit=BATCH_LIMIT,
        )

    def _assert_readonly_capture(self, op: str) -> None:
        if not self.live_capture_implementations_enabled:
            raise ProductionClusterIoForbidden(f"live_capture_implementations_disabled:{op}")
        if self.allow_readonly_probe:
            return
        if not self.allow_cluster_io:
            raise ProductionClusterIoForbidden(f"cluster_io_disabled:{op}")
        if self.packet.get("status") != "AUTHORIZED":
            raise ProductionClusterIoForbidden(f"packet_not_authorized:{op}")
        if self.packet.get("live_window_authorized") is not True:
            raise ProductionClusterIoForbidden(f"live_window_flag_false:{op}")
        if not LIVE_CAPTURE_ARMED_FOR_WINDOW:
            raise ProductionClusterIoForbidden(f"live_capture_not_armed_for_window:{op}")

    def publisher_tick(self, index: int, invocation_id: str) -> Mapping[str, Any]:
        self._assert_readonly_capture("publisher_tick")
        return self.capture.publisher_tick(index, invocation_id)

    def bind_lifecycle_rows(
        self, invocation_id: str, published: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        self._assert_readonly_capture("bind_lifecycle_rows")
        return self.capture.bind_lifecycle_rows(invocation_id, published)

    def record_metadata(
        self, invocation_id: str, published: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        self._assert_readonly_capture("record_metadata")
        return self.capture.record_metadata(invocation_id, published)

    def partition_leader_snapshots(
        self, invocation_id: str, published: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        self._assert_readonly_capture("partition_leader_snapshots")
        return self.capture.partition_leader_snapshots(invocation_id, published)

    def runtime_pin(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("runtime_pin")
        return self.capture.runtime_pin()

    def observability_snapshot(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("observability_snapshot")
        # Explicit T0 freeze at baseline capture (before publisher ticks).
        self.capture.capture_db_t0()
        return self.capture.observability_snapshot()

    def scrape_auction_monitor_metrics(self) -> str:
        self._assert_readonly_capture("scrape_auction_monitor_metrics")
        return scrape_auction_monitor_prometheus(runner=self.capture.runner)

    def validate_live_a1_counters(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("validate_live_a1_counters")
        return validate_live_a1_counters_from_prometheus(self.scrape_auction_monitor_metrics())

    def docker_execution_plane(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("docker_execution_plane")
        pin = self.capture._require_docker_pin()
        return docker_execution_plane_as_dict(pin)

    def kafka_leader_snapshot(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("kafka_leader_snapshot")
        now = utc_now()
        return capture_leader_snapshot(
            runner=self.capture.runner,
            captured_at_utc=now,
            valid_from=now,
            valid_until=None,
        )

    def publisher_log_cursor_readonly(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("publisher_log_cursor_readonly")
        return capture_publisher_log_cursor_readonly(
            runner=self.capture.runner, captured_at_utc=utc_now()
        )

    def database_equation_terms(self) -> Mapping[str, Any]:
        self._assert_readonly_capture("database_equation_terms")
        return self.capture.database_equation_terms()

    def independent_final_root_audit(self, canary_root: Path) -> Mapping[str, Any]:
        if self.require_packet_authorized and self.packet.get("status") != "AUTHORIZED":
            raise ProductionClusterIoForbidden("independent_audit_requires_authorized_packet")
        command = [
            sys.executable,
            str(self.repo / "scripts" / "audit-auction-monitor-canary-v3-final-root.py"),
            "--canary-root",
            str(canary_root),
            "--pre-done",
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        try:
            verdict = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {
                "verdict": "FAIL",
                "exit_code": 2,
                "audit_failures": [
                    f"auditor_invalid_output:{completed.stderr or completed.stdout}"
                ],
            }
        if "exit_code" not in verdict:
            verdict["exit_code"] = 2
            verdict.setdefault("audit_failures", []).append("auditor_exit_code_missing")
        if completed.returncode != int(verdict["exit_code"]):
            verdict["exit_code"] = 2
            verdict.setdefault("audit_failures", []).append("auditor_process_exit_mismatch")
        return verdict

    def query_plane_preflight(self) -> Mapping[str, Any]:
        if self.allow_readonly_probe:
            return build_query_plane_preflight(pin=self.query_plane_pin)
        if self.require_packet_authorized and self.packet.get("status") != "AUTHORIZED":
            raise ProductionClusterIoForbidden("query_plane_preflight_requires_authorized_packet")
        return build_query_plane_preflight(pin=self.query_plane_pin)

    def poll(self, **kwargs: Any) -> Mapping[str, Any]:
        if self.allow_readonly_probe:
            return poll_exact_trace(**kwargs)
        if self.require_packet_authorized and self.packet.get("status") != "AUTHORIZED":
            raise ProductionClusterIoForbidden("poll_requires_authorized_packet")
        return poll_exact_trace(**kwargs)

    def orchestrator_hooks(self) -> dict[str, Callable[..., Any]]:
        return {
            "publisher_tick_fn": wrap_production_hook(self.publisher_tick),
            "bind_lifecycle_rows_fn": wrap_production_hook(self.bind_lifecycle_rows),
            "record_metadata_fn": wrap_production_hook(self.record_metadata),
            "partition_leader_snapshots_fn": wrap_production_hook(self.partition_leader_snapshots),
            "database_equation_terms_fn": wrap_production_hook(self.database_equation_terms),
            "runtime_pin_fn": wrap_production_hook(self.runtime_pin),
            "observability_snapshot_fn": wrap_production_hook(self.observability_snapshot),
            "auditor_fn": wrap_production_hook(self.independent_final_root_audit),
            "preflight_fn": wrap_production_hook(self.query_plane_preflight),
            "poll_fn": wrap_production_hook(self.poll),
        }


# Mark class methods as production adapters for direct attribute checks.
for _name in (
    "publisher_tick",
    "bind_lifecycle_rows",
    "record_metadata",
    "partition_leader_snapshots",
    "database_equation_terms",
    "runtime_pin",
    "observability_snapshot",
    "scrape_auction_monitor_metrics",
    "validate_live_a1_counters",
    "docker_execution_plane",
    "kafka_leader_snapshot",
    "publisher_log_cursor_readonly",
    "independent_final_root_audit",
    "query_plane_preflight",
    "poll",
):
    production_adapter(getattr(ProductionAdapterBundle, _name))


def build_prepared_live_window_authorization_packet(
    *,
    expected_runtime_sha: str,
    query_plane_pin: QueryPlanePin,
    repo: Path | None = None,
) -> dict[str, Any]:
    hashes = compute_production_adapter_source_hashes(repo)
    return {
        "schema": LIVE_WINDOW_PACKET_SCHEMA,
        "status": "PREPARED_NOT_AUTHORIZED",
        "live_window_authorized": False,
        "example_or_prepared_only": True,
        "expected_runtime_sha": expected_runtime_sha,
        "adapter_source_hashes": hashes,
        "query_plane_pin": {
            "hostname": JAEGER_HOSTNAME_LOCKED,
            "metallb_ip": METALLB_IP_LOCKED,
            "jaeger_base": JAEGER_BASE_LOCKED,
            "leaf_sha256": query_plane_pin.leaf_sha256,
            "intermediate_sha256": query_plane_pin.intermediate_sha256,
            "root_sha256": query_plane_pin.root_sha256,
        },
        "throughput_pin": {
            "batch": BATCH_LIMIT,
            "interval_seconds": SCHEDULED_INTERVAL_S,
            "invocations": EXPECTED_INVOCATIONS,
        },
        "rollback_conditions": [
            "restore_publisher_batch_25_interval_120s_on_any_acceptance_failure",
            "never_mutate_historical_outbox_rows",
            "never_forceFlush_without_separate_authorization",
            "abort_window_on_jaeger_or_otel_restart_or_oom_growth",
            "abort_window_on_runtime_pin_drift",
            "abort_window_on_root_lease_loss_or_foreign_writer",
            "leave_incomplete_root_immutable_never_retry_into_pass",
        ],
        "notes": [
            "This packet freezes adapter hashes and pins for a future live arm.",
            "status PREPARED_NOT_AUTHORIZED does not authorize execution.",
            "live_capture_implementations exist but LIVE_CAPTURE_ACCEPTANCE_READY=false.",
            "LIVE_CAPTURE_ARMED_FOR_WINDOW remains false until an AUTHORIZED arm.",
        ],
        "live_capture_implementations_enabled": True,
        "live_capture_acceptance_ready": False,
        "live_capture_armed_for_window": False,
    }


def write_prepared_live_window_authorization_packet(
    dest: Path | str,
    *,
    expected_runtime_sha: str,
    query_plane_pin: QueryPlanePin,
    repo: Path | None = None,
) -> dict[str, Any]:
    packet = build_prepared_live_window_authorization_packet(
        expected_runtime_sha=expected_runtime_sha,
        query_plane_pin=query_plane_pin,
        repo=repo,
    )
    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(packet, indent=2) + "\n").encode()
    dest_path.write_bytes(raw)
    Path(f"{dest_path}.sha256").write_text(sha256_bytes(raw) + "\n")
    return packet
