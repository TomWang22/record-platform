#!/usr/bin/env python3
"""Race-safe, evidence-bound canary-v3 window orchestrator."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

LIB_DIR = Path(__file__).resolve().parent
REPO = LIB_DIR.parents[1]
sys.path.insert(0, str(LIB_DIR))

from auction_monitor_canary_v3_trace import (  # noqa: E402
    BATCH_LIMIT,
    EXPECTED_INVOCATIONS,
    SCHEDULED_INTERVAL_S,
    QueryPlanePin,
    assert_owner,
    atomic_create_only_json,
    atomic_create_only_text,
    build_query_plane_preflight,
    close_root_lease,
    evaluate_execution_authorization_from_reports,
    evaluate_observability_stability_gate,
    mark_root_incomplete,
    poll_exact_trace,
    utc_now,
)

PublisherTickFn = Callable[[int, str], Mapping[str, Any]]
PollFn = Callable[..., Mapping[str, Any]]
PreflightFn = Callable[[], Mapping[str, Any]]
RuntimePinFn = Callable[[], Mapping[str, Any]]
SnapshotFn = Callable[[], Mapping[str, Any]]


def fixture_safe(adapter: Callable[..., Any]) -> Callable[..., Any]:
    setattr(adapter, "is_fixture_adapter", True)
    return adapter


class FixturePublisherAdapter:
    is_fixture_adapter = True

    def __init__(self, callback: PublisherTickFn):
        self.callback = callback

    def __call__(self, index: int, invocation_id: str) -> Mapping[str, Any]:
        return self.callback(index, invocation_id)


def schedule_invocation(
    *,
    index: int,
    window_start_monotonic: float,
    schedule_interval_s: float = SCHEDULED_INTERVAL_S,
    max_start_drift_s: float = 5,
    sleep_fn: Callable[[float], None] = time.sleep,
    monotonic_fn: Callable[[], float] = time.monotonic,
) -> dict[str, float]:
    target = window_start_monotonic + index * schedule_interval_s
    remaining = target - monotonic_fn()
    if remaining > 0:
        sleep_fn(remaining)
    started = monotonic_fn()
    drift = started - target
    if drift > max_start_drift_s:
        raise RuntimeError(f"max_start_drift_exceeded:{drift:.6f}")
    return {
        "scheduled_monotonic": target,
        "start_monotonic": started,
        "drift_ms": round(drift * 1000, 3),
    }


def _claim_root(root: Path, writer_id: str, owner_token: str) -> None:
    root.parent.mkdir(parents=True, exist_ok=True)
    os.mkdir(root)
    atomic_create_only_json(
        root / "writer.lock.json",
        {
            "writer_id": writer_id,
            "owner_token": owner_token,
            "claimed_at_utc": utc_now(),
        },
    )
    atomic_create_only_text(root / "lease" / "RUNNING", f"{owner_token}\n")


def _independent_audit(root: Path, *, pre_done: bool) -> dict[str, Any]:
    auditor = REPO / "scripts" / "audit-auction-monitor-canary-v3-final-root.py"
    command = [sys.executable, str(auditor), "--canary-root", str(root)]
    if pre_done:
        command.append("--pre-done")
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        verdict = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {
            "verdict": "FAIL",
            "exit_code": 2,
            "audit_failures": [f"auditor_invalid_output:{completed.stderr or completed.stdout}"],
        }
    if "exit_code" not in verdict:
        verdict["exit_code"] = 2
        verdict.setdefault("audit_failures", []).append("auditor_exit_code_missing")
    if completed.returncode != int(verdict["exit_code"]):
        verdict["exit_code"] = 2
        verdict.setdefault("audit_failures", []).append("auditor_process_exit_mismatch")
    return verdict


def _publish_post_terminal_audit(
    root: Path, audit_publish_dir: Path | str | None, owner_token: str
) -> tuple[dict[str, Any], Path]:
    publish_dir = Path(
        audit_publish_dir
        or (Path("/tmp") / "record-platform-canary-v3-audit" / owner_token)
    )
    publish_dir.mkdir(parents=True, exist_ok=True)
    verdict = _independent_audit(root, pre_done=False)
    atomic_create_only_json(publish_dir / "post-terminal-audit.json", verdict)
    return verdict, publish_dir


def _hook_flag(hook: Callable[..., Any] | None, name: str) -> bool:
    if hook is None:
        return False
    if getattr(hook, name, False) is True:
        return True
    func = getattr(hook, "__func__", None)
    return getattr(func, name, False) is True


def _validate_hook_policy(
    *,
    dry_run: bool,
    fixture_mode: bool,
    live_confirmed: bool,
    hooks: Sequence[Callable[..., Any] | None],
) -> str | None:
    if fixture_mode or dry_run:
        if not fixture_mode:
            return "dry_run_requires_fixture_mode"
        if any(hook is not None and not _hook_flag(hook, "is_fixture_adapter") for hook in hooks):
            return "unmarked_fixture_hook_forbidden"
        if any(_hook_flag(hook, "is_production_adapter") for hook in hooks):
            return "production_adapter_forbidden_in_fixture_or_dry_run"
        return None
    if not live_confirmed:
        return "live_window_confirmation_required"
    if any(hook is not None and _hook_flag(hook, "is_fixture_adapter") for hook in hooks):
        return "fixture_adapter_forbidden_in_live_mode"
    if any(
        hook is not None and not _hook_flag(hook, "is_production_adapter")
        for hook in hooks
    ):
        return "live_production_adapters_required"
    return None


def _acceptance_structure(value: Any, key: str, expected_count: int) -> bool:
    return isinstance(value, Mapping) and isinstance(value.get(key), list) and len(value[key]) == expected_count


def run_canary_v3_window(
    *,
    root: Path | str,
    authorization_report_path: Path | str,
    stability_report_path: Path | str,
    expected_runtime_sha: str,
    query_plane_pin: QueryPlanePin,
    writer_id: str | None = None,
    invocation_ids: Sequence[str] | None = None,
    publisher_tick_fn: PublisherTickFn | None = None,
    poll_fn: PollFn = poll_exact_trace,
    preflight_fn: PreflightFn | None = None,
    bind_lifecycle_rows_fn: Callable[[str, Mapping[str, Any]], Any] | None = None,
    record_metadata_fn: Callable[[str, Mapping[str, Any]], Any] | None = None,
    partition_leader_snapshots_fn: Callable[[str, Mapping[str, Any]], Any] | None = None,
    database_equation_terms_fn: Callable[[], Mapping[str, Any]] | None = None,
    auditor_fn: Callable[[Path], Mapping[str, Any]] | None = None,
    runtime_pin_fn: RuntimePinFn | None = None,
    observability_snapshot_fn: SnapshotFn | None = None,
    audit_publish_dir: Path | str | None = None,
    schedule_interval_s: float = SCHEDULED_INTERVAL_S,
    max_start_drift_s: float = 5,
    sleep_fn: Callable[[float], None] = time.sleep,
    monotonic_fn: Callable[[], float] = time.monotonic,
    dry_run: bool = True,
    fixture_mode: bool = False,
    live_confirmed: bool = False,
) -> dict[str, Any]:
    hooks = (
        publisher_tick_fn,
        poll_fn,
        preflight_fn,
        bind_lifecycle_rows_fn,
        record_metadata_fn,
        partition_leader_snapshots_fn,
        database_equation_terms_fn,
        auditor_fn,
        runtime_pin_fn,
        observability_snapshot_fn,
    )
    policy_error = _validate_hook_policy(
        dry_run=dry_run,
        fixture_mode=fixture_mode,
        live_confirmed=live_confirmed,
        hooks=hooks,
    )
    if policy_error:
        return {"status": "EXECUTION_REFUSED", "reason": policy_error}
    mandatory = {
        "publisher_tick_fn": publisher_tick_fn,
        "bind_lifecycle_rows_fn": bind_lifecycle_rows_fn,
        "record_metadata_fn": record_metadata_fn,
        "database_equation_terms_fn": database_equation_terms_fn,
        "runtime_pin_fn": runtime_pin_fn,
        "observability_snapshot_fn": observability_snapshot_fn,
    }
    if live_confirmed and not fixture_mode:
        mandatory["partition_leader_snapshots_fn"] = partition_leader_snapshots_fn
    missing_hooks = [name for name, hook in mandatory.items() if hook is None]
    if missing_hooks:
        reason = "live_publisher_adapter_required" if "publisher_tick_fn" in missing_hooks and not fixture_mode else "mandatory_accounting_or_snapshot_adapter_required"
        return {"status": "EXECUTION_REFUSED", "reason": reason, "missing_hooks": missing_hooks}

    authorization = evaluate_execution_authorization_from_reports(
        authorization_report_path, stability_report_path, expected_runtime_sha
    )
    if not authorization["may_execute_window"]:
        return {"status": "EXECUTION_REFUSED", "reason": "frozen_reports_did_not_authorize", "authorization": authorization}
    preflight = dict(preflight_fn() if preflight_fn else build_query_plane_preflight(pin=query_plane_pin))
    if preflight.get("status") != "PASS":
        return {"status": "EXECUTION_REFUSED", "reason": "query_plane_preflight_not_pass", "preflight": preflight}
    ids = list(invocation_ids or [str(uuid.uuid4()) for _ in range(EXPECTED_INVOCATIONS)])
    if len(ids) != EXPECTED_INVOCATIONS or any(not item for item in ids) or len(set(ids)) != len(ids):
        return {"status": "EXECUTION_REFUSED", "reason": "invalid_invocation_id_denominator"}

    canary_root = Path(root)
    claimed_writer = writer_id or str(uuid.uuid4())
    owner_token = str(uuid.uuid4())
    owned = False
    try:
        try:
            _claim_root(canary_root, claimed_writer, owner_token)
            owned = True
        except FileExistsError:
            return {"status": "EXECUTION_REFUSED", "reason": "root_already_exists", "canary_root": str(canary_root)}

        atomic_create_only_json(canary_root / "authorization-evaluation.json", authorization)
        preflight_path = canary_root / "query-plane-preflight.json"
        atomic_create_only_json(preflight_path, preflight)
        preflight_sha = hashlib.sha256(preflight_path.read_bytes()).hexdigest()
        baseline = dict(observability_snapshot_fn())
        atomic_create_only_json(canary_root / "observability" / "baseline.json", baseline)
        runtime_start = dict(runtime_pin_fn())
        required_pin = {"pod_uid", "image_digest", "oci_revision", "RP_SOURCE_SHA"}
        if set(runtime_start) < required_pin or any(not runtime_start.get(key) for key in required_pin):
            raise ValueError("runtime_pin_incomplete")
        window_start_mono = monotonic_fn()
        atomic_create_only_json(
            canary_root / "window_start.json",
            {
                "captured_at_utc": utc_now(),
                "dry_run": dry_run,
                "fixture_mode": fixture_mode,
                "expected_runtime_sha": expected_runtime_sha,
                "runtime_pin": runtime_start,
                "query_plane_preflight_sha256": preflight_sha,
                "throughput_pin": {
                    "batch": BATCH_LIMIT,
                    "interval_seconds": SCHEDULED_INTERVAL_S,
                    "invocations": EXPECTED_INVOCATIONS,
                },
                "harness_schedule_interval_s": schedule_interval_s,
                "synchronous_polling_policy": True,
                "max_start_drift_s": max_start_drift_s,
                "force_flush": False,
                "throughput_change": False,
                "historical_outbox_rows_mutated": 0,
            },
        )
        atomic_create_only_json(
            canary_root / "invocation-manifest.json",
            {"schema": "canary-v3-invocation-manifest/v1", "invocation_ids": ids, "count": EXPECTED_INVOCATIONS, "sealed_at_utc": utc_now()},
        )
        trace_misses: list[str] = []
        accounting_failures: list[str] = []
        for index, invocation_id in enumerate(ids):
            schedule = schedule_invocation(
                index=index,
                window_start_monotonic=window_start_mono,
                schedule_interval_s=schedule_interval_s,
                max_start_drift_s=max_start_drift_s,
                sleep_fn=sleep_fn,
                monotonic_fn=monotonic_fn,
            )
            published = dict(publisher_tick_fn(index, invocation_id))
            trace_id = published.get("trace_id") or published.get("requested_trace_id")
            lifecycle = bind_lifecycle_rows_fn(invocation_id, published)
            metadata = record_metadata_fn(invocation_id, published)
            if not _acceptance_structure(lifecycle, "rows", BATCH_LIMIT):
                accounting_failures.append(f"lifecycle_rows_not_25:{invocation_id}")
            if not _acceptance_structure(metadata, "records", BATCH_LIMIT):
                accounting_failures.append(f"record_metadata_not_25:{invocation_id}")
            atomic_create_only_json(canary_root / "lifecycle" / f"{invocation_id}.json", lifecycle)
            atomic_create_only_json(canary_root / "record-metadata" / f"{invocation_id}.json", metadata)
            if partition_leader_snapshots_fn is not None:
                leaders = partition_leader_snapshots_fn(invocation_id, published)
                if not _acceptance_structure(leaders, "snapshots", BATCH_LIMIT):
                    accounting_failures.append(f"partition_leader_snapshots_not_25:{invocation_id}")
                atomic_create_only_json(
                    canary_root / "partition-leaders" / f"{invocation_id}.json", leaders
                )
            if not isinstance(trace_id, str) or not trace_id:
                trace_misses.append(invocation_id)
                schedule["end_monotonic"] = monotonic_fn()
                atomic_create_only_json(canary_root / "invocations" / f"{invocation_id}.json", {"invocation_id": invocation_id, "index": index, "publisher_tick": published, **schedule})
                continue
            final = dict(
                poll_fn(
                    invocation_id=invocation_id,
                    requested_trace_id=trace_id,
                    dest_dir=canary_root / "traces" / invocation_id,
                    query_plane_preflight_sha256=preflight_sha,
                )
            )
            schedule["end_monotonic"] = monotonic_fn()
            atomic_create_only_json(canary_root / "invocations" / f"{invocation_id}.json", {"invocation_id": invocation_id, "index": index, "publisher_tick": published, **schedule, "captured_at_utc": utc_now()})
            if final.get("trace_queryable_at_capture") is not True:
                trace_misses.append(invocation_id)

        if fixture_mode:
            from auction_monitor_canary_v3_live_capture import build_fixture_db_provenance

            equation = build_fixture_db_provenance(
                canary_root,
                expected_runtime_sha=expected_runtime_sha,
                runtime_pin=runtime_start,
            )
        else:
            equation = dict(database_equation_terms_fn())
            atomic_create_only_json(canary_root / "database-equation-terms.json", equation)
        post = dict(observability_snapshot_fn())
        atomic_create_only_json(canary_root / "observability" / "post_window.json", post)
        stability = evaluate_observability_stability_gate(
            baseline=baseline,
            current=post,
            baseline_captured_at_utc=baseline["captured_at_utc"],
            current_captured_at_utc=post["captured_at_utc"],
            window_seconds=0 if fixture_mode else 3600,
            margin_seconds=0 if fixture_mode else 600,
        )
        atomic_create_only_json(canary_root / "observability" / "stability-final.json", stability)
        runtime_end = dict(runtime_pin_fn())
        atomic_create_only_json(canary_root / "window_end.json", {"captured_at_utc": utc_now(), "runtime_pin": runtime_end, "historical_outbox_rows_mutated": 0})
        if runtime_end != runtime_start:
            accounting_failures.append("runtime_pin_changed")
        if stability.get("pass") is not True:
            accounting_failures.append("observability_stability_failed")
        if trace_misses or accounting_failures:
            mark_root_incomplete(canary_root, "acceptance_evidence_incomplete", trace_misses, owner_token=owner_token)
            close_root_lease(canary_root, owner_token, "INCOMPLETE")
            post_terminal, publish_dir = _publish_post_terminal_audit(
                canary_root, audit_publish_dir, owner_token
            )
            return {"status": "CANARY_INCOMPLETE", "trace_misses": trace_misses, "accounting_failures": accounting_failures, "audit_failures": [], "canary_root": str(canary_root), "post_terminal_audit": post_terminal, "audit_publish_dir": str(publish_dir)}

        audit = dict(auditor_fn(canary_root) if auditor_fn else _independent_audit(canary_root, pre_done=True))
        if audit.get("verdict") != "PASS" or audit.get("exit_code") != 0:
            mark_root_incomplete(canary_root, "independent_auditor_failed", [], owner_token=owner_token)
            close_root_lease(canary_root, owner_token, "INCOMPLETE")
            post_terminal, publish_dir = _publish_post_terminal_audit(
                canary_root, audit_publish_dir, owner_token
            )
            return {"status": "CANARY_INCOMPLETE", "reason": "independent_auditor_failed", "audit": audit, "trace_misses": [], "accounting_failures": [], "audit_failures": audit.get("audit_failures", ["independent_auditor_failed"]), "canary_root": str(canary_root), "post_terminal_audit": post_terminal, "audit_publish_dir": str(publish_dir)}

        assert_owner(canary_root, owner_token)
        atomic_create_only_json(canary_root / "CANARY_DONE", {"status": "DONE", "completed_at_utc": utc_now(), "auditor_verdict": audit})
        close_root_lease(canary_root, owner_token, "DONE")
        post_terminal, publish_dir = _publish_post_terminal_audit(
            canary_root, audit_publish_dir, owner_token
        )
        return {"status": "CANARY_DONE", "invocations": EXPECTED_INVOCATIONS, "canary_root": str(canary_root), "audit": audit, "post_terminal_audit": post_terminal, "audit_publish_dir": str(publish_dir)}
    except Exception as exc:  # noqa: BLE001
        if owned:
            try:
                assert_owner(canary_root, owner_token)
                if not (canary_root / "CANARY_DONE").exists() and not (canary_root / "CANARY_INCOMPLETE").exists():
                    mark_root_incomplete(canary_root, f"{type(exc).__name__}:{exc}", [], owner_token=owner_token)
                    close_root_lease(canary_root, owner_token, "INCOMPLETE")
                    _publish_post_terminal_audit(
                        canary_root, audit_publish_dir, owner_token
                    )
            except (FileExistsError, PermissionError):
                pass
        return {"status": "CANARY_INCOMPLETE" if owned else "EXECUTION_REFUSED", "reason": f"{type(exc).__name__}:{exc}", "canary_root": str(canary_root)}


def _fixture_main(fixture_path: Path) -> int:
    fixture = json.loads(fixture_path.read_text())
    failed_index = fixture.get("failed_index")
    empty_lifecycle = fixture.get("empty_lifecycle", False)
    ids = [f"00000000-0000-4000-8000-{index:012d}" for index in range(EXPECTED_INVOCATIONS)]
    runtime_pin = {"pod_uid": "fixture-pod", "image_digest": "sha256:fixture", "oci_revision": "fixture-revision", "RP_SOURCE_SHA": fixture["expected_runtime_sha"]}
    snapshot_count = {"value": 0}
    schedule_clock = {"value": 0.0}

    @fixture_safe
    def publisher(index: int, _invocation_id: str) -> dict[str, Any]:
        return {"trace_id": f"trace-{index:02d}", "publisher_tick": index}

    @fixture_safe
    def poll(**kwargs: Any) -> Mapping[str, Any]:
        trace_id = kwargs["requested_trace_id"]
        clock = {"value": 0.0}

        def fetch(_url: str, _timeout_s: float) -> dict[str, Any]:
            if failed_index is not None and trace_id == f"trace-{int(failed_index):02d}":
                clock["value"] += 0.002
                return {"http_status": 404, "content_type": "application/json", "body": b"{}"}
            return {"http_status": 200, "content_type": "application/json", "body": json.dumps({"data": [{"traceID": trace_id, "spans": [{"spanID": "fixture"}]}]}).encode()}

        return poll_exact_trace(
            **kwargs,
            max_wall_seconds=0.001 if failed_index is not None and trace_id == f"trace-{int(failed_index):02d}" else 1,
            fetch_fn=fetch,
            sleep_fn=lambda seconds: clock.__setitem__("value", clock["value"] + seconds),
            monotonic_fn=lambda: clock["value"],
            utc_fn=lambda: "2026-08-06T12:00:00Z",
        )

    @fixture_safe
    def preflight() -> Mapping[str, Any]:
        return {"status": "PASS", "fixture": True, "captured_at_utc": "2026-08-06T12:00:00Z"}

    @fixture_safe
    def lifecycle(invocation_id: str, published: Mapping[str, Any]) -> Mapping[str, Any]:
        rows = []
        if not empty_lifecycle:
            for row_index in range(BATCH_LIMIT):
                correlation = hashlib.sha256(f"{invocation_id}:{row_index}".encode()).hexdigest()
                rows.append({"classification": "DATABASE_ACKNOWLEDGED", "correlation_hash": correlation, "partition": row_index % 3, "offset": int(published["publisher_tick"]) * BATCH_LIMIT + row_index, "leader_broker_id": row_index % 3 + 1, "selection_timestamp": "2026-08-06T12:00:00Z", "produce_timestamp": "2026-08-06T12:00:01Z", "broker_timestamp": "2026-08-06T12:00:02Z", "db_timestamp": "2026-08-06T12:00:03Z", "trace_id": published["trace_id"], "offset_provenance": "RecordMetadata", "leader_snapshot_valid": True})
        return {"invocation_id": invocation_id, "rows": rows}

    @fixture_safe
    def metadata(invocation_id: str, published: Mapping[str, Any]) -> Mapping[str, Any]:
        records = []
        for row_index in range(BATCH_LIMIT):
            records.append({"correlation_hash": hashlib.sha256(f"{invocation_id}:{row_index}".encode()).hexdigest(), "partition": row_index % 3, "offset": int(published["publisher_tick"]) * BATCH_LIMIT + row_index, "primary": True})
        return {"invocation_id": invocation_id, "records": records}

    @fixture_safe
    def equation() -> Mapping[str, Any]:
        return {
            "pending_delta": 0,
            "created_unpublished": 750,
            "database_acknowledged": 750,
            "reopened": 0,
            "deleted_unpublished": 0,
            "reopened_proof": {"count": 0, "source": "fixture"},
            "deleted_unpublished_proof": {"count": 0, "source": "fixture"},
            "t0": {"pending": 0, "total": 0, "published_true": 0, "label": "T0"},
            "t1": {"pending": 0, "total": 750, "published_true": 750, "label": "T1"},
        }

    @fixture_safe
    def runtime() -> Mapping[str, Any]:
        return runtime_pin

    @fixture_safe
    def snapshot() -> Mapping[str, Any]:
        value = {"captured_at_utc": f"2026-08-06T12:00:0{snapshot_count['value']}Z", "jaeger_ready": True, "jaeger_storage_ready": True, "jaeger_restart_count": 0, "jaeger_oomkill_count": 0, "otel_collector_restart_count": 0}
        snapshot_count["value"] += 1
        return value

    @fixture_safe
    def auditor_without_exit_code(_root: Path) -> Mapping[str, Any]:
        return {"verdict": "PASS"}

    result = run_canary_v3_window(
        root=fixture["root"],
        authorization_report_path=fixture["authorization_report_path"],
        stability_report_path=fixture["stability_report_path"],
        expected_runtime_sha=fixture["expected_runtime_sha"],
        query_plane_pin=QueryPlanePin("leaf", "intermediate", "root"),
        invocation_ids=ids,
        publisher_tick_fn=publisher,
        poll_fn=poll,
        preflight_fn=preflight,
        bind_lifecycle_rows_fn=fixture_safe(lifecycle),
        record_metadata_fn=fixture_safe(metadata),
        database_equation_terms_fn=fixture_safe(equation),
        runtime_pin_fn=fixture_safe(runtime),
        observability_snapshot_fn=fixture_safe(snapshot),
        auditor_fn=auditor_without_exit_code if fixture.get("auditor_missing_exit_code") else None,
        audit_publish_dir=fixture.get("audit_publish_dir"),
        schedule_interval_s=0,
        max_start_drift_s=1,
        sleep_fn=lambda seconds: schedule_clock.__setitem__(
            "value", schedule_clock["value"] + seconds
        ),
        monotonic_fn=lambda: schedule_clock["value"],
        dry_run=True,
        fixture_mode=True,
    )
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "CANARY_DONE" else 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--canary-root", type=Path)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--i-understand-live-window", action="store_true")
    args = parser.parse_args(argv)
    if args.fixture:
        return _fixture_main(args.fixture)
    print(json.dumps({"status": "EXECUTION_REFUSED", "reason": "live_publisher_adapter_required"}, indent=2))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
