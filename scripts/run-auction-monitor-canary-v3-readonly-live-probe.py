#!/usr/bin/env python3
"""PREPARED-packet read-only live probe for canary-v3 (A2).

Never starts the one-hour window. Harness mode never emits
READ_ONLY_LIVE_PROBE_PASS. Live mode emits PASS only when hashed T0/T1
provenance recomputes, the common interval is proven, and every observation
plane validates — still without authorizing the window.

Writes probe report + optional .PROBED packet copy; does not overwrite the
source-controlled .PREPARED.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "lib"))

from auction_monitor_canary_v3_live_capture import (  # noqa: E402
    EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS,
    EXPECTED_OBSERVABILITY_PODS,
    LIVE_CAPTURE_ACCEPTANCE_READY,
    DockerExecutionPlanePin,
    LiveCaptureError,
    REQUIRED_PROVENANCE_COUNTER_SERIES,
    VALID_KAFKA_BROKER_IDS,
    build_and_write_db_provenance,
    build_fixture_db_provenance,
    capture_db_counts_snapshot,
    capture_docker_execution_plane,
    capture_leader_snapshot,
    capture_observability_snapshot,
    capture_publisher_log_cursor_readonly,
    capture_runtime_pin,
    default_command_runner,
    docker_execution_plane_as_dict,
    extract_process_start_time_seconds,
    independently_recompute_db_provenance,
    scrape_auction_monitor_prometheus,
)
from auction_monitor_canary_v3_production_adapters import (  # noqa: E402
    LIVE_CAPTURE_ARMED_FOR_WINDOW,
    LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED,
    load_live_window_authorization_packet,
    sha256_bytes,
    validate_live_window_authorization_packet,
)
from auction_monitor_canary_v3_trace import (  # noqa: E402
    QueryPlanePin,
    build_query_plane_preflight,
    utc_now,
)

# Code path exists; acceptance remains owner-gated.
A2_LIVE_IMPLEMENTED = True
A2_LIVE_ACCEPTANCE_READY = False

ObservationFn = Callable[[], Mapping[str, Any]]
MetricsFn = Callable[[], str]
DbSnapshotFn = Callable[[str, Mapping[str, Any]], Mapping[str, Any]]
WaitFn = Callable[[], None]


@dataclass(frozen=True)
class LiveReadonlyProbeAdapters:
    """Injectable production-adapter surface for live probe (real or mocked)."""

    scrape_auction_monitor_metrics: MetricsFn
    capture_runtime_pin: ObservationFn
    capture_docker_execution_plane: ObservationFn
    capture_query_plane: ObservationFn
    capture_kafka_leaders: ObservationFn
    capture_db_snapshot: DbSnapshotFn
    capture_publisher_log_cursor: ObservationFn
    capture_observability: ObservationFn
    bounded_interval_wait: WaitFn = lambda: None


def _write_json(path: Path, payload: dict[str, Any]) -> str:
    raw = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    digest = sha256_bytes(raw)
    Path(f"{path}.sha256").write_text(digest + "\n")
    return digest


def _base_forbidden_posture() -> dict[str, Any]:
    return {
        "cluster_mutation_attempted": False,
        "publisher_invocation_triggered": False,
        "outbox_rows_mutated": 0,
        "throughput_changed": False,
        "live_window_authorized": False,
        "execution_authorized": False,
        "live_capture_acceptance_ready": False,
        "live_capture_armed_for_window": False,
        "live_capture_implementations_enabled": LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED,
        "a2_live_implemented": A2_LIVE_IMPLEMENTED,
        "a2_live_acceptance_ready": A2_LIVE_ACCEPTANCE_READY,
    }


def _prepared_tamper_report(
    *,
    prepared_sha_before: str,
) -> dict[str, Any]:
    return {
        "schema": "canary-v3-live-readonly-probe/v1",
        "verdict": "PACKET_STATUS_TAMPER_ATTEMPT",
        "read_only_live_probe_pass": False,
        "prepared_packet_sha256": prepared_sha_before,
        "prepared_packet_byte_equal_after": False,
        "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
        **_base_forbidden_posture(),
    }


def _ensure_prepared_untampered(
    packet_path: Path,
    prepared_bytes_before: bytes,
    prepared_sha_before: str,
    out_path: Path,
) -> dict[str, Any] | None:
    if packet_path.read_bytes() == prepared_bytes_before:
        return None
    report = _prepared_tamper_report(prepared_sha_before=prepared_sha_before)
    _write_json(out_path, report)
    return report


def _emit_terminal_report(
    *,
    report: dict[str, Any],
    out_path: Path,
    packet: Mapping[str, Any],
    packet_path: Path,
    prepared_bytes_before: bytes,
    prepared_sha_before: str,
    probed_packet_path: Path | None = None,
    observed: Mapping[str, Any] | None = None,
    note: str | None = None,
    probe_root: Path | None = None,
) -> dict[str, Any]:
    """Write probe JSON + unauthorized PROBED snapshot for every terminal result (Option A)."""
    _write_json(out_path, report)
    if probed_packet_path is not None:
        _write_probed_packet(
            packet=packet,
            probed_packet_path=probed_packet_path,
            observed=observed or {},
            note=note
            or (
                f"PROBED snapshot for terminal verdict {report.get('verdict')}; "
                "status remains PREPARED_NOT_AUTHORIZED; not an authorization."
            ),
        )
    if probe_root is not None:
        shutil.rmtree(probe_root, ignore_errors=True)
    if packet_path.read_bytes() == prepared_bytes_before:
        return report
    tamper = _prepared_tamper_report(prepared_sha_before=prepared_sha_before)
    _write_json(out_path, tamper)
    if probed_packet_path is not None:
        _write_probed_packet(
            packet=packet,
            probed_packet_path=probed_packet_path,
            observed=observed or {},
            note=(
                "PROBED snapshot after PACKET_STATUS_TAMPER_ATTEMPT; "
                "status remains PREPARED_NOT_AUTHORIZED; not an authorization."
            ),
        )
    return tamper


def _validate_ticket1_provenance_fixture(*, repo: Path) -> dict[str, Any]:
    del repo
    tmp = Path(tempfile.mkdtemp(prefix="am-v3-probe-prov-"))
    try:
        equation = build_fixture_db_provenance(
            tmp,
            expected_runtime_sha="probe-readiness-sha",
            runtime_pin={"pod_uid": "probe-pod", "RP_SOURCE_SHA": "probe-readiness-sha"},
        )
        t0 = (tmp / "db-provenance" / "metrics" / "t0.prom.txt").read_text()
        t1 = (tmp / "db-provenance" / "metrics" / "t1.prom.txt").read_text()
        series_ok = all(name in t0 and name in t1 for name in REQUIRED_PROVENANCE_COUNTER_SERIES)
        if not series_ok or equation.get("schema") != "canary-v3-database-equation-terms/v2":
            return {"ready": False, "reason": "provenance_artifacts_incomplete"}
        recompute = independently_recompute_db_provenance(tmp)
        if not recompute.get("pass"):
            return {
                "ready": False,
                "reason": "fixture_recompute_failed",
                "detail": recompute,
            }
        return {
            "ready": True,
            "reason": "ticket1_provenance_tree_validated",
            "required_series": list(REQUIRED_PROVENANCE_COUNTER_SERIES),
            "equation_schema": equation.get("schema"),
            "verification": "fixture_tree",
            "auditor_recompute_pass": True,
            "common_interval_proven": True,
            "counter_epoch_unchanged": True,
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def build_default_live_adapters(
    *,
    query_plane_pin: QueryPlanePin,
    command_runner: Any | None = None,
    interval_wait_s: float = 1.0,
) -> LiveReadonlyProbeAdapters:
    runner = command_runner if command_runner is not None else default_command_runner

    def _metrics() -> str:
        return scrape_auction_monitor_prometheus(runner=runner)

    def _runtime() -> Mapping[str, Any]:
        pin = capture_runtime_pin(runner=runner)
        out = dict(pin)
        out["captured_at_utc"] = utc_now()
        return out

    def _docker() -> Mapping[str, Any]:
        return docker_execution_plane_as_dict(capture_docker_execution_plane(runner=runner))

    def _query() -> Mapping[str, Any]:
        return build_query_plane_preflight(pin=query_plane_pin)

    def _kafka() -> Mapping[str, Any]:
        now = utc_now()
        snap = capture_leader_snapshot(
            runner=runner,
            captured_at_utc=now,
            valid_from=now,
            valid_until=None,
        )
        leaders = snap.get("leaders") or {}
        snap["partition_count"] = len(leaders)
        return snap

    def _db(label: str, docker_pin: Mapping[str, Any]) -> Mapping[str, Any]:
        pin = DockerExecutionPlanePin(
            colima_profile=str(docker_pin.get("colima_profile") or ""),
            docker_host=str(docker_pin.get("docker_host") or ""),
            docker_context=str(docker_pin.get("docker_context") or ""),
            compose_project=str(
                docker_pin.get("compose_project") or "record-platform"
            ),
            compose_service=str(
                docker_pin.get("compose_service") or "postgres-auction-monitor-core"
            ),
            container_id=str(docker_pin.get("container_id") or ""),
            container_name=str(docker_pin.get("container_name") or ""),
            image_digest=str(docker_pin.get("image_digest") or ""),
        )
        return capture_db_counts_snapshot(
            runner=runner,
            docker_pin=pin,
            label=label,
            captured_at_utc=utc_now(),
            verify_pin=True,
        )

    def _cursor() -> Mapping[str, Any]:
        return capture_publisher_log_cursor_readonly(
            runner=runner, captured_at_utc=utc_now()
        )

    def _obs() -> Mapping[str, Any]:
        return capture_observability_snapshot(
            runner=runner, captured_at_utc=utc_now()
        )

    def _wait() -> None:
        time.sleep(interval_wait_s)

    return LiveReadonlyProbeAdapters(
        scrape_auction_monitor_metrics=_metrics,
        capture_runtime_pin=_runtime,
        capture_docker_execution_plane=_docker,
        capture_query_plane=_query,
        capture_kafka_leaders=_kafka,
        capture_db_snapshot=_db,
        capture_publisher_log_cursor=_cursor,
        capture_observability=_obs,
        bounded_interval_wait=_wait,
    )


def _validate_query_plane(payload: Mapping[str, Any]) -> list[str]:
    gaps: list[str] = []
    stages = payload.get("stages")
    if not isinstance(stages, Mapping):
        return ["query_plane:stages_not_mapping"]
    for stage in ("stage1_dns", "stage2_tls", "stage3_api_health"):
        body = stages.get(stage)
        if not isinstance(body, Mapping):
            gaps.append(f"query_plane:missing:{stage}")
            continue
        if body.get("status") != "PASS":
            gaps.append(f"query_plane:{stage}:not_pass")
    stage2 = stages.get("stage2_tls") if isinstance(stages.get("stage2_tls"), Mapping) else {}
    observed = stage2.get("observed") if isinstance(stage2.get("observed"), Mapping) else {}
    for fp in ("leaf_sha256", "intermediate_sha256", "root_sha256"):
        value = str(observed.get(fp) or "")
        if not value or value.startswith("UNSET"):
            gaps.append(f"query_plane:fingerprint_missing:{fp}")
    stage3 = stages.get("stage3_api_health") if isinstance(stages.get("stage3_api_health"), Mapping) else {}
    health = stage3.get("health") if isinstance(stage3.get("health"), Mapping) else {}
    if health.get("ok") is not True:
        gaps.append("query_plane:api_not_healthy")
    for count_key in (
        "localhost_query_count",
        "port_forward_query_count",
        "fallback_query_count",
    ):
        if count_key not in payload:
            gaps.append(f"query_plane:missing:{count_key}")
        elif payload.get(count_key) not in (0, 0.0):
            gaps.append(f"query_plane:nonzero_{count_key}")
    if payload.get("pass") is not True and payload.get("status") != "PASS":
        gaps.append("query_plane:overall_not_pass")
    return gaps


def _validate_observability(payload: Mapping[str, Any]) -> list[str]:
    gaps: list[str] = []
    expected = payload.get("expected_pods")
    if not isinstance(expected, Mapping) or dict(expected) != dict(EXPECTED_OBSERVABILITY_PODS):
        gaps.append("observability:expected_pods_mismatch")
    mapping = {
        "app=jaeger": ("jaeger_pod_count", "jaeger_ready"),
        "app=jaeger-storage": ("jaeger_storage_pod_count", "jaeger_storage_ready"),
        "app=otel-collector": ("otel_collector_pod_count", "otel_collector_ready"),
    }
    for label, (count_key, ready_key) in mapping.items():
        want = int(EXPECTED_OBSERVABILITY_PODS[label])
        if payload.get(count_key) != want:
            gaps.append(f"observability:count_mismatch:{count_key}")
        if payload.get(ready_key) is not True:
            gaps.append(f"observability:not_ready:{ready_key}")
    return gaps


def _validate_kafka_leaders(payload: Mapping[str, Any]) -> list[str]:
    gaps: list[str] = []
    leaders = payload.get("leaders")
    if not isinstance(leaders, Mapping) or not leaders:
        return ["kafka_leaders:missing:leaders"]
    expected_keys = {str(i) for i in range(EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS)}
    actual_keys = {str(k) for k in leaders.keys()}
    if actual_keys != expected_keys:
        gaps.append(
            f"kafka_leaders:partition_denominator_mismatch:"
            f"{sorted(actual_keys)}!={sorted(expected_keys)}"
        )
    partition_count = payload.get("partition_count")
    if partition_count is not None and int(partition_count) != EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS:
        gaps.append("kafka_leaders:partition_count_mismatch")
    elif partition_count is None and len(leaders) != EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS:
        gaps.append("kafka_leaders:partition_count_implicit_mismatch")
    for key, broker in leaders.items():
        try:
            broker_id = int(broker)
        except (TypeError, ValueError):
            gaps.append(f"kafka_leaders:invalid_broker:{key}")
            continue
        if broker_id not in VALID_KAFKA_BROKER_IDS:
            gaps.append(f"kafka_leaders:broker_out_of_range:{broker_id}")
    if not payload.get("topic"):
        gaps.append("kafka_leaders:missing:topic")
    if not payload.get("raw_describe_sha256"):
        gaps.append("kafka_leaders:missing:raw_describe_sha256")
    return gaps


def _validate_docker_db_pin(
    docker_plane: Mapping[str, Any], db_snap: Mapping[str, Any], label: str
) -> list[str]:
    gaps: list[str] = []
    pin = db_snap.get("docker_pin")
    if not isinstance(pin, Mapping):
        return [f"db_{label.lower()}:missing:docker_pin"]
    for key in ("container_id", "container_name", "docker_context", "image_digest"):
        if not docker_plane.get(key):
            gaps.append(f"docker_execution_plane:missing:{key}")
        if pin.get(key) != docker_plane.get(key):
            gaps.append(f"db_{label.lower()}:docker_pin_mismatch:{key}")
    for key in ("pending", "total", "captured_at_utc", "label"):
        if db_snap.get(key) in (None, ""):
            gaps.append(f"db_{label.lower()}:missing:{key}")
    if db_snap.get("label") != label:
        gaps.append(f"db_{label.lower()}:label_mismatch")
    return gaps


def _validate_runtime(payload: Mapping[str, Any]) -> list[str]:
    gaps: list[str] = []
    for key in ("pod_uid", "image_digest", "RP_SOURCE_SHA"):
        if not payload.get(key):
            gaps.append(f"runtime_pin:missing:{key}")
    return gaps


def collect_and_validate_observation_planes(
    adapters: LiveReadonlyProbeAdapters,
    *,
    docker_plane: Mapping[str, Any],
    db_t0: Mapping[str, Any],
    db_t1: Mapping[str, Any],
    runtime_t0: Mapping[str, Any],
    runtime_t1: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    observed: dict[str, Any] = {
        "mode": "live_readonly",
        "runtime_pin_t0": dict(runtime_t0),
        "runtime_pin_t1": dict(runtime_t1),
        "docker_execution_plane": dict(docker_plane),
        "db_t0": dict(db_t0),
        "db_t1": dict(db_t1),
    }
    gaps: list[str] = []
    gaps.extend(_validate_runtime(runtime_t0))
    gaps.extend(_validate_runtime(runtime_t1))
    gaps.extend(_validate_docker_db_pin(docker_plane, db_t0, "T0"))
    gaps.extend(_validate_docker_db_pin(docker_plane, db_t1, "T1"))

    for name, fn in (
        ("query_plane", adapters.capture_query_plane),
        ("kafka_leaders", adapters.capture_kafka_leaders),
        ("publisher_log_cursor", adapters.capture_publisher_log_cursor),
        ("observability", adapters.capture_observability),
    ):
        try:
            payload = dict(fn())
        except Exception as exc:  # noqa: BLE001
            gaps.append(f"{name}:capture_error:{type(exc).__name__}:{exc}")
            observed[name] = {"error": str(exc)}
            continue
        observed[name] = payload
        if name == "query_plane":
            gaps.extend(_validate_query_plane(payload))
        elif name == "kafka_leaders":
            gaps.extend(_validate_kafka_leaders(payload))
        elif name == "observability":
            gaps.extend(_validate_observability(payload))
        elif name == "publisher_log_cursor":
            for key in ("since_time_utc", "log_byte_length"):
                if payload.get(key) in (None, ""):
                    gaps.append(f"publisher_log_cursor:missing:{key}")
            if payload.get("publisher_invocation_triggered") is not False:
                gaps.append("publisher_log_cursor:publisher_invocation_triggered_not_false")
    return observed, gaps


def capture_live_provenance_interval(
    adapters: LiveReadonlyProbeAdapters,
    *,
    probe_root: Path,
) -> dict[str, Any]:
    """Capture bounded T0/T1 scrapes + DB snapshots; freeze hashed provenance tree."""
    try:
        docker_plane = dict(adapters.capture_docker_execution_plane())
        runtime_t0 = dict(adapters.capture_runtime_pin())
        prom_t0 = adapters.scrape_auction_monitor_metrics()
        db_t0 = dict(adapters.capture_db_snapshot("T0", docker_plane))
        interval_start = utc_now()
        adapters.bounded_interval_wait()
        runtime_t1 = dict(adapters.capture_runtime_pin())
        prom_t1 = adapters.scrape_auction_monitor_metrics()
        db_t1 = dict(adapters.capture_db_snapshot("T1", docker_plane))
        interval_end = utc_now()
        # Second-resolution clocks can collapse a zero-wait mock interval.
        if interval_end <= interval_start:
            start_dt = datetime.strptime(interval_start, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc
            )
            interval_end = (start_dt + timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception as exc:  # noqa: BLE001
        return {
            "ready": False,
            "reason": f"live_interval_capture_error:{type(exc).__name__}:{exc}",
            "auditor_recompute_pass": False,
            "common_interval_proven": False,
            "counter_epoch_unchanged": False,
            "required_series_present": False,
        }

    try:
        pst0 = extract_process_start_time_seconds(prom_t0)
        pst1 = extract_process_start_time_seconds(prom_t1)
    except LiveCaptureError as exc:
        return {
            "ready": False,
            "reason": str(exc),
            "auditor_recompute_pass": False,
            "common_interval_proven": False,
            "counter_epoch_unchanged": False,
            "required_series_present": False,
            "docker_plane": docker_plane,
            "runtime_t0": runtime_t0,
            "runtime_t1": runtime_t1,
            "db_t0": db_t0,
            "db_t1": db_t1,
        }

    runtime_sha = str(runtime_t0.get("RP_SOURCE_SHA") or "")
    source_sha = runtime_sha
    epoch = {
        "test_run_id": str(uuid.uuid4()),
        "source_sha": source_sha,
        "runtime_sha": runtime_sha,
        "pod_uid_t0": str(runtime_t0.get("pod_uid") or ""),
        "pod_uid_t1": str(runtime_t1.get("pod_uid") or ""),
        "process_start_time_t0": pst0,
        "process_start_time_t1": pst1,
        "counter_epoch_unchanged": pst0 == pst1
        and runtime_t0.get("pod_uid") == runtime_t1.get("pod_uid")
        and runtime_t0.get("RP_SOURCE_SHA") == runtime_t1.get("RP_SOURCE_SHA"),
        "writer_count": 1,
    }

    try:
        equation = build_and_write_db_provenance(
            probe_root,
            t0_prom_text=prom_t0,
            t1_prom_text=prom_t1,
            db_t0=db_t0,
            db_t1=db_t1,
            interval_start_utc=interval_start,
            interval_end_utc=interval_end,
            epoch=epoch,
            expected_source_sha=source_sha,
            expected_runtime_sha=runtime_sha,
        )
        recompute = independently_recompute_db_provenance(probe_root)
    except LiveCaptureError as exc:
        return {
            "ready": False,
            "reason": f"provenance_build_failed:{exc}",
            "auditor_recompute_pass": False,
            "common_interval_proven": False,
            "counter_epoch_unchanged": bool(epoch.get("counter_epoch_unchanged")),
            "required_series_present": False,
            "docker_plane": docker_plane,
            "runtime_t0": runtime_t0,
            "runtime_t1": runtime_t1,
            "db_t0": db_t0,
            "db_t1": db_t1,
            "epoch": epoch,
        }

    ready = bool(recompute.get("pass"))
    return {
        "ready": ready,
        "reason": "live_t0_t1_provenance_recompute_pass" if ready else "live_recompute_failed",
        "verification": "live_hashed_t0_t1_recompute",
        "auditor_recompute_pass": bool(recompute.get("auditor_recompute_pass")),
        "common_interval_proven": bool(recompute.get("common_interval_proven")),
        "counter_epoch_unchanged": bool(recompute.get("counter_epoch_unchanged")),
        "required_series_present": bool(recompute.get("required_series_present")),
        "recompute": recompute,
        "equation_schema": equation.get("schema"),
        "docker_plane": docker_plane,
        "runtime_t0": runtime_t0,
        "runtime_t1": runtime_t1,
        "db_t0": db_t0,
        "db_t1": db_t1,
        "epoch": epoch,
        "probe_root": str(probe_root),
    }


def _write_probed_packet(
    *,
    packet: Mapping[str, Any],
    probed_packet_path: Path,
    observed: Mapping[str, Any],
    note: str,
) -> None:
    probed = dict(packet)
    probed.pop("_packet_sha256", None)
    probed.pop("_packet_path", None)
    probed["status"] = "PREPARED_NOT_AUTHORIZED"
    probed["live_window_authorized"] = False
    probed["live_capture_acceptance_ready"] = False
    probed["live_capture_armed_for_window"] = False
    probed["example_or_prepared_only"] = True
    runtime = observed.get("runtime_pin_t1") or observed.get("runtime_pin_t0")
    if isinstance(runtime, Mapping) and runtime.get("RP_SOURCE_SHA"):
        probed["expected_runtime_sha"] = str(runtime["RP_SOURCE_SHA"])
        probed["runtime_pin_observed"] = {
            "pod_uid": runtime.get("pod_uid"),
            "image_digest": runtime.get("image_digest"),
            "RP_SOURCE_SHA": runtime.get("RP_SOURCE_SHA"),
            "pod_name": runtime.get("pod_name"),
        }
    query = observed.get("query_plane")
    if isinstance(query, Mapping):
        stages = query.get("stages") if isinstance(query.get("stages"), Mapping) else {}
        tls_obs: dict[str, Any] = {}
        if isinstance(stages, Mapping):
            stage2 = stages.get("stage2_tls")
            if isinstance(stage2, Mapping) and isinstance(stage2.get("observed"), Mapping):
                tls_obs = dict(stage2["observed"])
        pin = dict(probed.get("query_plane_pin") or {})
        for key in ("leaf_sha256", "intermediate_sha256", "root_sha256"):
            if tls_obs.get(key):
                pin[key] = tls_obs[key]
        probed["query_plane_pin"] = pin
    notes = list(probed.get("notes") or [])
    notes.append(note)
    probed["notes"] = notes
    _write_json(probed_packet_path, probed)


def run_readonly_live_probe(
    *,
    packet_path: Path,
    out_path: Path,
    mode: str = "harness",
    simulate_provenance_missing: bool = False,
    probed_packet_path: Path | None = None,
    repo: Path | None = None,
    live_adapters: LiveReadonlyProbeAdapters | None = None,
) -> dict[str, Any]:
    repo = Path(repo or REPO)
    prepared_bytes_before = packet_path.read_bytes()
    prepared_sha_before = sha256_bytes(prepared_bytes_before)
    packet = load_live_window_authorization_packet(packet_path)

    def emit(
        report: dict[str, Any],
        *,
        observed: Mapping[str, Any] | None = None,
        note: str | None = None,
        probe_root: Path | None = None,
    ) -> dict[str, Any]:
        return _emit_terminal_report(
            report=report,
            out_path=out_path,
            packet=packet,
            packet_path=packet_path,
            prepared_bytes_before=prepared_bytes_before,
            prepared_sha_before=prepared_sha_before,
            probed_packet_path=probed_packet_path,
            observed=observed,
            note=note,
            probe_root=probe_root,
        )

    if packet.get("status") != "PREPARED_NOT_AUTHORIZED":
        report = _prepared_tamper_report(prepared_sha_before=prepared_sha_before)
        report["detail"] = {"packet_status": packet.get("status")}
        return emit(report)

    pin = packet.get("query_plane_pin") or {}
    query_plane_pin = QueryPlanePin(
        leaf_sha256=str(pin.get("leaf_sha256") or ""),
        intermediate_sha256=str(pin.get("intermediate_sha256") or ""),
        root_sha256=str(pin.get("root_sha256") or ""),
    )
    validation = validate_live_window_authorization_packet(
        packet,
        expected_runtime_sha=str(packet.get("expected_runtime_sha") or ""),
        query_plane_pin=query_plane_pin,
        require_authorized=False,
        repo=repo,
    )
    if not validation["pass"]:
        return emit(
            {
                "schema": "canary-v3-live-readonly-probe/v1",
                "verdict": "PACKET_VALIDATION_FAILED",
                "failures": validation["failures"],
                "read_only_live_probe_pass": False,
                **_base_forbidden_posture(),
            }
        )

    if mode == "harness":
        provenance = (
            {"ready": False, "reason": "simulated_missing"}
            if simulate_provenance_missing
            else _validate_ticket1_provenance_fixture(repo=repo)
        )
        if not provenance.get("ready"):
            return emit(
                {
                    "schema": "canary-v3-live-readonly-probe/v1",
                    "verdict": "DB_PROVENANCE_NOT_READY",
                    "db_provenance": {
                        "status": "NOT_READY",
                        "required_series_present": False,
                        "auditor_recompute_pass": False,
                        "common_interval_proven": False,
                        "counter_epoch_unchanged": False,
                        "detail": provenance,
                    },
                    "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
                    "read_only_live_probe_pass": False,
                    **_base_forbidden_posture(),
                    "live_capture_acceptance_ready": LIVE_CAPTURE_ACCEPTANCE_READY,
                    "live_capture_armed_for_window": LIVE_CAPTURE_ARMED_FOR_WINDOW,
                }
            )

        return emit(
            {
                "schema": "canary-v3-live-readonly-probe/v1",
                "verdict": "HARNESS_PASS",
                "db_provenance": {
                    "status": "READY",
                    "required_series_present": True,
                    "auditor_recompute_pass": True,
                    "common_interval_proven": True,
                    "counter_epoch_unchanged": True,
                    "detail": provenance,
                },
                "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
                "read_only_live_probe_pass": False,
                **_base_forbidden_posture(),
                "observed": {
                    "mode": "harness_mock",
                    "runtime_pin": "not_collected_in_harness_mock",
                    "docker_execution_plane": "not_collected_in_harness_mock",
                    "query_plane": "not_collected_in_harness_mock",
                    "kafka_leaders": "not_collected_in_harness_mock",
                    "db_t0": "not_collected_in_harness_mock",
                },
                "packet_pins_written": False,
                "prepared_packet_sha256": prepared_sha_before,
                "prepared_packet_byte_equal_after": True,
                "note": "Harness mock never emits READ_ONLY_LIVE_PROBE_PASS or authorizes the window.",
            },
            note="PROBED copy from harness mock; pins not live-filled; not an authorization.",
        )

    # ---- live branch ----
    adapters = live_adapters or build_default_live_adapters(query_plane_pin=query_plane_pin)
    probe_root = Path(tempfile.mkdtemp(prefix="am-v3-live-probe-"))

    if simulate_provenance_missing:
        provenance = {
            "ready": False,
            "reason": "simulated_missing",
            "auditor_recompute_pass": False,
            "common_interval_proven": False,
            "counter_epoch_unchanged": False,
            "required_series_present": False,
        }
    else:
        provenance = capture_live_provenance_interval(adapters, probe_root=probe_root)

    if packet_path.read_bytes() != prepared_bytes_before:
        return emit(
            _prepared_tamper_report(prepared_sha_before=prepared_sha_before),
            probe_root=probe_root,
        )

    if not provenance.get("ready"):
        return emit(
            {
                "schema": "canary-v3-live-readonly-probe/v1",
                "verdict": "DB_PROVENANCE_NOT_READY",
                "db_provenance": {
                    "status": "NOT_READY",
                    "required_series_present": bool(provenance.get("required_series_present")),
                    "auditor_recompute_pass": False,
                    "common_interval_proven": bool(provenance.get("common_interval_proven")),
                    "counter_epoch_unchanged": bool(provenance.get("counter_epoch_unchanged")),
                    "detail": provenance,
                },
                "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
                "read_only_live_probe_pass": False,
                "prepared_packet_sha256": prepared_sha_before,
                "prepared_packet_byte_equal_after": True,
                **_base_forbidden_posture(),
            },
            probe_root=probe_root,
        )

    docker_plane = provenance["docker_plane"]
    observed, gaps = collect_and_validate_observation_planes(
        adapters,
        docker_plane=docker_plane,
        db_t0=provenance["db_t0"],
        db_t1=provenance["db_t1"],
        runtime_t0=provenance["runtime_t0"],
        runtime_t1=provenance["runtime_t1"],
    )
    observed["db_provenance_root"] = provenance.get("probe_root")

    if packet_path.read_bytes() != prepared_bytes_before:
        return emit(
            _prepared_tamper_report(prepared_sha_before=prepared_sha_before),
            observed=observed,
            probe_root=probe_root,
        )

    if gaps:
        return emit(
            {
                "schema": "canary-v3-live-readonly-probe/v1",
                "verdict": "LIVE_PROBE_OBSERVATIONS_INCOMPLETE",
                "db_provenance": {
                    "status": "READY",
                    "required_series_present": True,
                    "auditor_recompute_pass": True,
                    "common_interval_proven": True,
                    "counter_epoch_unchanged": True,
                    "detail": provenance,
                },
                "observation_gaps": gaps,
                "observed": observed,
                "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
                "read_only_live_probe_pass": False,
                "prepared_packet_sha256": prepared_sha_before,
                "prepared_packet_byte_equal_after": True,
                **_base_forbidden_posture(),
            },
            observed=observed,
            probe_root=probe_root,
        )

    return emit(
        {
            "schema": "canary-v3-live-readonly-probe/v1",
            "verdict": "READ_ONLY_LIVE_PROBE_PASS",
            "db_provenance": {
                "status": "READY",
                "required_series_present": True,
                "auditor_recompute_pass": True,
                "common_interval_proven": True,
                "counter_epoch_unchanged": True,
                "detail": {
                    "verification": provenance.get("verification"),
                    "equation_schema": provenance.get("equation_schema"),
                    "recompute": provenance.get("recompute"),
                },
            },
            "observed": observed,
            "observation_gaps": [],
            "cluster_mutation_attempted": False,
            "publisher_invocation_triggered": False,
            "outbox_rows_mutated": 0,
            "throughput_changed": False,
            "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
            "read_only_live_probe_pass": True,
            "live_window_authorized": False,
            "execution_authorized": False,
            "live_capture_acceptance_ready": False,
            "live_capture_armed_for_window": False,
            "live_capture_implementations_enabled": LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED,
            "a2_live_implemented": A2_LIVE_IMPLEMENTED,
            "a2_live_acceptance_ready": A2_LIVE_ACCEPTANCE_READY,
            "prepared_packet_sha256": prepared_sha_before,
            "prepared_packet_byte_equal_after": True,
            "packet_pins_written": probed_packet_path is not None,
            "note": (
                "READ_ONLY_LIVE_PROBE_PASS does not authorize canary-v3. "
                "A2_LIVE_ACCEPTANCE_READY and LIVE_CAPTURE_ACCEPTANCE_READY remain false."
            ),
        },
        observed=observed,
        note=(
            "PROBED copy from A2-live read-only probe; status remains "
            "PREPARED_NOT_AUTHORIZED; not an authorization."
        ),
        probe_root=probe_root,
    )

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--packet",
        type=Path,
        default=REPO / "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO / "reports/outbox/canary-v3-live-readonly-probe.json",
    )
    parser.add_argument("--mode", choices=("harness", "live"), default="harness")
    parser.add_argument("--simulate-provenance-missing", action="store_true")
    parser.add_argument(
        "--probed-packet-out",
        type=Path,
        default=REPO / "reports/outbox/canary-v3-live-window-authorization-packet.PROBED.json",
    )
    parser.add_argument("--no-probed-packet", action="store_true")
    args = parser.parse_args(argv)
    report = run_readonly_live_probe(
        packet_path=args.packet,
        out_path=args.out,
        mode=args.mode,
        simulate_provenance_missing=args.simulate_provenance_missing,
        probed_packet_path=None if args.no_probed_packet else args.probed_packet_out,
    )
    print(json.dumps(report, indent=2))
    verdict = report.get("verdict")
    if verdict in {"HARNESS_PASS", "READ_ONLY_LIVE_PROBE_PASS"}:
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
