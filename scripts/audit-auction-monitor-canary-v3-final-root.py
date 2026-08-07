#!/usr/bin/env python3
"""Acceptance auditor that reconstructs canary-v3 evidence from primary files."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "lib"))

from auction_monitor_canary_v3_trace import (  # noqa: E402
    BATCH_LIMIT,
    EXPECTED_INVOCATIONS,
    SCHEDULED_INTERVAL_S,
    validate_invocation_denominator_from_root,
)


from auction_monitor_canary_v3_trace import (  # noqa: E402
    BATCH_LIMIT,
    EXPECTED_INVOCATIONS,
    SCHEDULED_INTERVAL_S,
    validate_invocation_denominator_from_root,
)
from auction_monitor_canary_v3_live_capture import (  # noqa: E402
    REQUIRED_PROVENANCE_COUNTER_SERIES,
    parse_prometheus_exposition,
)

_TERM_TO_SERIES = {
    "created_unpublished": "auction_monitor_outbox_created_total",
    "database_acknowledged": "auction_monitor_outbox_db_acknowledged_total",
    "reopened": "auction_monitor_outbox_reopened_total",
    "deleted_unpublished": "auction_monitor_outbox_deleted_unpublished_total",
}

_EPOCH_FIELDS = (
    "test_run_id",
    "source_sha",
    "runtime_sha",
    "pod_uid_t0",
    "pod_uid_t1",
    "process_start_time_t0",
    "process_start_time_t1",
    "counter_epoch_unchanged",
    "writer_count",
)


def _load(path: Path, failures: list[str], label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        failures.append(f"invalid_{label}:{exc}")
        return {}


def _safe_artifact(root: Path, rel: str, failures: list[str], label: str) -> Path | None:
    if not isinstance(rel, str) or not rel:
        failures.append(f"foreign_artifact_path:{label}:missing")
        return None
    if rel.startswith("/") or rel.startswith("\\") or ".." in Path(rel).parts:
        failures.append(f"foreign_artifact_path:{label}:{rel}")
        return None
    candidate = root / rel
    try:
        if candidate.is_symlink():
            resolved = candidate.resolve()
            if root.resolve() not in resolved.parents and resolved != root.resolve():
                failures.append(f"foreign_artifact_path:{label}:symlink_escape:{rel}")
                return None
        resolved = candidate.resolve()
        root_resolved = root.resolve()
        if root_resolved not in resolved.parents and resolved != root_resolved:
            failures.append(f"foreign_artifact_path:{label}:{rel}")
            return None
        if not str(resolved).startswith(str(root_resolved)):
            failures.append(f"foreign_artifact_path:{label}:{rel}")
            return None
    except OSError as exc:
        failures.append(f"foreign_artifact_path:{label}:{exc}")
        return None
    if not candidate.is_file():
        failures.append(f"artifact_missing:{label}:{rel}")
        return None
    return candidate


def _resolve_unlabeled_series(
    samples: list[dict[str, Any]], series: str, failures: list[str], side: str
) -> float | None:
    matches = [s for s in samples if s.get("name") == series]
    if not matches:
        failures.append(f"missing_required_series:{side}:{series}")
        return None
    by_labels: dict[tuple[tuple[str, str], ...], list[dict[str, Any]]] = {}
    for sample in matches:
        key = tuple(sorted((str(k), str(v)) for k, v in (sample.get("labels") or {}).items()))
        by_labels.setdefault(key, []).append(sample)
    if len(by_labels) != 1:
        failures.append(f"label_set_drift:{side}:{series}")
        return None
    label_key, group = next(iter(by_labels.items()))
    if label_key:
        failures.append(f"label_set_drift:{side}:{series}")
        return None
    if len(group) != 1:
        failures.append(f"duplicate_series:{side}:{series}")
        return None
    return float(group[0]["value"])


def _audit_db_provenance(root: Path, accounting_failures: list[str]) -> dict[str, Any]:
    report = {
        "schema": None,
        "raw_hashes_verified": False,
        "counter_epoch_verified": False,
        "terms_recomputed": False,
        "summary_matches_recomputed": False,
        "identity_verified": False,
    }
    equation = _load(root / "database-equation-terms.json", accounting_failures, "database_equation")
    report["schema"] = equation.get("schema")
    if equation.get("schema") != "canary-v3-database-equation-terms/v2":
        accounting_failures.append("database_equation_schema_not_v2")
        return report
    if equation.get("provenance_root") != "db-provenance":
        accounting_failures.append("provenance_root_invalid")
        return report

    interval = _load(root / "db-provenance" / "interval.json", accounting_failures, "db_provenance_interval")
    if not interval:
        return report
    if not interval.get("interval_start_utc") or not interval.get("interval_end_utc"):
        accounting_failures.append("interval_mismatch:missing_bounds")
    elif str(interval["interval_start_utc"]) >= str(interval["interval_end_utc"]):
        accounting_failures.append("interval_mismatch:order")

    for key in _EPOCH_FIELDS:
        if key not in interval and key not in equation:
            accounting_failures.append(f"epoch_field_missing:{key}")

    epoch = {key: interval.get(key, equation.get(key)) for key in _EPOCH_FIELDS}
    if epoch.get("pod_uid_t0") != epoch.get("pod_uid_t1"):
        accounting_failures.append("pod_uid_drift")
    try:
        if float(epoch.get("process_start_time_t0")) != float(epoch.get("process_start_time_t1")):
            accounting_failures.append("process_start_time_drift")
    except (TypeError, ValueError):
        accounting_failures.append("process_start_time_drift")
    if epoch.get("counter_epoch_unchanged") is not True:
        accounting_failures.append("counter_epoch_unchanged_false")
    try:
        if int(epoch.get("writer_count")) != 1:
            accounting_failures.append("writer_count_not_one")
    except (TypeError, ValueError):
        accounting_failures.append("writer_count_not_one")
    for pin_key in ("source_sha", "runtime_sha", "test_run_id"):
        if equation.get(pin_key) is not None and interval.get(pin_key) is not None:
            if equation.get(pin_key) != interval.get(pin_key):
                accounting_failures.append(f"{pin_key}_drift")

    report["counter_epoch_verified"] = not any(
        f.startswith(("pod_uid_", "process_start_", "counter_epoch_", "writer_count_", "source_sha_", "runtime_sha_", "test_run_id_"))
        or f.startswith("epoch_field_missing")
        for f in accounting_failures
    )

    t0_meta = _load(root / "db-provenance" / "metrics" / "t0.meta.json", accounting_failures, "t0_meta")
    t1_meta = _load(root / "db-provenance" / "metrics" / "t1.meta.json", accounting_failures, "t1_meta")
    t0_prom = _safe_artifact(root, t0_meta.get("artifact_path", "db-provenance/metrics/t0.prom.txt"), accounting_failures, "t0_prom")
    t1_prom = _safe_artifact(root, t1_meta.get("artifact_path", "db-provenance/metrics/t1.prom.txt"), accounting_failures, "t1_prom")
    db_t0_path = _safe_artifact(root, "db-provenance/snapshots/db-t0.json", accounting_failures, "db_t0")
    db_t1_path = _safe_artifact(root, "db-provenance/snapshots/db-t1.json", accounting_failures, "db_t1")
    if not t0_prom or not t1_prom or not db_t0_path or not db_t1_path:
        return report

    t0_sha = hashlib.sha256(t0_prom.read_bytes()).hexdigest()
    t1_sha = hashlib.sha256(t1_prom.read_bytes()).hexdigest()
    if t0_sha != t0_meta.get("artifact_sha256"):
        accounting_failures.append("raw_prometheus_hash_mismatch:t0")
    if t1_sha != t1_meta.get("artifact_sha256"):
        accounting_failures.append("raw_prometheus_hash_mismatch:t1")

    db_t0 = _load(db_t0_path, accounting_failures, "db_t0_snapshot")
    db_t1 = _load(db_t1_path, accounting_failures, "db_t1_snapshot")
    # Snapshot hashes are bound via term pending_delta artifact_sha fields below.
    report["raw_hashes_verified"] = not any(
        f.startswith("raw_prometheus_hash_mismatch") or f.startswith("foreign_artifact_path") or f.startswith("artifact_missing")
        for f in accounting_failures
    )

    t0_samples = parse_prometheus_exposition(t0_prom.read_text())
    t1_samples = parse_prometheus_exposition(t1_prom.read_text())
    t0_vals: dict[str, float] = {}
    t1_vals: dict[str, float] = {}
    for series in REQUIRED_PROVENANCE_COUNTER_SERIES:
        v0 = _resolve_unlabeled_series(t0_samples, series, accounting_failures, "t0")
        v1 = _resolve_unlabeled_series(t1_samples, series, accounting_failures, "t1")
        if v0 is None or v1 is None:
            continue
        if v1 < v0:
            accounting_failures.append(f"counter_reset:{series}")
            continue
        t0_vals[series] = v0
        t1_vals[series] = v1

    recomputed: dict[str, int] = {}
    for term, series in _TERM_TO_SERIES.items():
        if series not in t0_vals or series not in t1_vals:
            continue
        recomputed[term] = int(t1_vals[series] - t0_vals[series])

    try:
        pending_recomputed = int(db_t1["pending"]) - int(db_t0["pending"])
        recomputed["pending_delta"] = pending_recomputed
    except (KeyError, TypeError, ValueError):
        accounting_failures.append("pending_delta_snapshot_invalid")

    for term, series in _TERM_TO_SERIES.items():
        term_path = root / "db-provenance" / "terms" / f"{term}.json"
        term_obj = _load(term_path, accounting_failures, f"term_{term}")
        if not term_obj:
            accounting_failures.append(f"missing_zero_delta_term_file:{term}")
            continue
        proof = term_obj.get("proof") if isinstance(term_obj.get("proof"), dict) else {}
        source_type = term_obj.get("source_type")
        if source_type == "column_absence" or str(proof.get("kind", "")).startswith("column_absent"):
            accounting_failures.append(f"column_absence_proof:{term}")
        if proof.get("derived_from_column_absence") is True:
            accounting_failures.append(f"column_absence_proof:{term}")
        if source_type in {"total_delta", "published_true_delta"} or proof.get("kind") in {
            "total_delta",
            "published_true_delta",
            "count_identity",
        }:
            accounting_failures.append(f"circular_count_derived_proof:{term}")
        for path_key in ("artifact_path_t0", "artifact_path_t1"):
            _safe_artifact(root, str(term_obj.get(path_key) or ""), accounting_failures, f"{term}:{path_key}")
        if term_obj.get("interval_start_utc") != interval.get("interval_start_utc") or term_obj.get(
            "interval_end_utc"
        ) != interval.get("interval_end_utc"):
            accounting_failures.append(f"interval_mismatch:{term}")
        if term in recomputed and int(term_obj.get("delta", -1)) != recomputed[term]:
            accounting_failures.append(f"term_delta_mismatch:{term}")
        if term in recomputed:
            if int(term_obj.get("start_value", -1)) != int(t0_vals[series]):
                accounting_failures.append(f"term_start_mismatch:{term}")
            if int(term_obj.get("end_value", -1)) != int(t1_vals[series]):
                accounting_failures.append(f"term_end_mismatch:{term}")
        if term_obj.get("artifact_sha256_t0") != t0_sha or term_obj.get("artifact_sha256_t1") != t1_sha:
            accounting_failures.append(f"term_hash_mismatch:{term}")
        for pin_key in ("pod_uid_t0", "pod_uid_t1", "process_start_time_t0", "process_start_time_t1", "source_sha", "runtime_sha", "test_run_id"):
            if pin_key in term_obj and pin_key in epoch and term_obj.get(pin_key) != epoch.get(pin_key):
                accounting_failures.append(f"{pin_key}_drift:{term}")

    pending_term = _load(
        root / "db-provenance" / "terms" / "pending_delta.json",
        accounting_failures,
        "term_pending_delta",
    )
    if pending_term:
        for path_key, expected_rel in (
            ("artifact_path_t0", "db-provenance/snapshots/db-t0.json"),
            ("artifact_path_t1", "db-provenance/snapshots/db-t1.json"),
        ):
            rel = str(pending_term.get(path_key) or "")
            art = _safe_artifact(root, rel, accounting_failures, f"pending_delta:{path_key}")
            if art and rel != expected_rel:
                # Allow exact expected relative path only for snapshot terms.
                if Path(rel).as_posix() != expected_rel:
                    accounting_failures.append(f"foreign_artifact_path:pending_delta:{rel}")
        db_t0_sha = hashlib.sha256(db_t0_path.read_bytes()).hexdigest()
        db_t1_sha = hashlib.sha256(db_t1_path.read_bytes()).hexdigest()
        if pending_term.get("artifact_sha256_t0") != db_t0_sha:
            accounting_failures.append("db_snapshot_hash_mismatch:t0")
        if pending_term.get("artifact_sha256_t1") != db_t1_sha:
            accounting_failures.append("db_snapshot_hash_mismatch:t1")
        if "pending_delta" in recomputed and int(pending_term.get("delta", -1)) != recomputed["pending_delta"]:
            accounting_failures.append("term_delta_mismatch:pending_delta")
        if pending_term.get("interval_start_utc") != interval.get("interval_start_utc"):
            accounting_failures.append("interval_mismatch:pending_delta")
    else:
        accounting_failures.append("missing_zero_delta_term_file:pending_delta")

    report["terms_recomputed"] = all(t in recomputed for t in (*_TERM_TO_SERIES, "pending_delta"))

    for key in ("pending_delta", "created_unpublished", "database_acknowledged", "reopened", "deleted_unpublished"):
        if key not in recomputed:
            continue
        try:
            summary_val = int(equation[key])
        except (KeyError, TypeError, ValueError):
            accounting_failures.append(f"summary_value_invalid:{key}")
            continue
        if summary_val < 0 and key != "pending_delta":
            accounting_failures.append(f"summary_only_negative_delta:{key}")
        if summary_val != recomputed[key]:
            accounting_failures.append(f"summary_value_mismatch:{key}")

    if all(k in recomputed for k in _TERM_TO_SERIES) and "pending_delta" in recomputed:
        identity = recomputed["pending_delta"] == (
            recomputed["created_unpublished"]
            - recomputed["database_acknowledged"]
            + recomputed["reopened"]
            - recomputed["deleted_unpublished"]
        )
        report["identity_verified"] = identity
        if not identity:
            accounting_failures.append("pending_equation_mismatch")
        expected_rows = EXPECTED_INVOCATIONS * BATCH_LIMIT
        if recomputed.get("database_acknowledged") != expected_rows:
            accounting_failures.append("database_acknowledged_not_750")
    report["summary_matches_recomputed"] = not any(
        f.startswith("summary_value_mismatch") or f.startswith("summary_only_negative") for f in accounting_failures
    )

    # Retain legacy proof presence checks for older consumers of the equation doc.
    for proof in ("reopened_proof", "deleted_unpublished_proof"):
        if not isinstance(equation.get(proof), dict) or not equation[proof]:
            accounting_failures.append(f"{proof}_missing")
    if not isinstance(equation.get("t0"), dict) or not equation.get("t0"):
        accounting_failures.append("database_equation_t0_missing")
    if not isinstance(equation.get("t1"), dict) or not equation.get("t1"):
        accounting_failures.append("database_equation_t1_missing")
    return report


def audit_root(root: Path, *, require_done: bool = True) -> dict[str, Any]:
    trace_misses: list[str] = []
    accounting_failures: list[str] = []
    audit_failures: list[str] = []
    denominator = validate_invocation_denominator_from_root(root)
    if not denominator["pass"]:
        trace_misses.extend(denominator["errors"])
    done = (root / "CANARY_DONE").exists()
    incomplete = (root / "CANARY_INCOMPLETE").exists()
    if done and incomplete:
        audit_failures.append("done_and_incomplete_markers_are_mutually_exclusive")
    if incomplete:
        audit_failures.append("canary_incomplete_present")
    if require_done and not done:
        audit_failures.append("canary_done_missing")
    if not require_done and done:
        audit_failures.append("canary_done_present_before_pre_done_audit")

    # Lease ownership is mandatory only for terminal acceptance audits.
    if require_done:
        lock = _load(root / "writer.lock.json", audit_failures, "writer_lock")
        terminal = _load(root / "lease" / "TERMINAL.json", audit_failures, "lease_terminal")
        if lock and terminal:
            if lock.get("owner_token") != terminal.get("owner_token"):
                audit_failures.append("foreign_lease_owner_token_mismatch")
            if not lock.get("owner_token"):
                audit_failures.append("writer_lock_owner_token_missing")
        closed = _load(root / "writer.lease_closed.json", audit_failures, "writer_lease_closed")
        if lock and closed and closed.get("owner_token") != lock.get("owner_token"):
            audit_failures.append("foreign_lease_closed_token_mismatch")

    manifest = _load(root / "invocation-manifest.json", audit_failures, "invocation_manifest")
    ids = manifest.get("invocation_ids", [])
    if not isinstance(ids, list) or len(ids) != EXPECTED_INVOCATIONS:
        accounting_failures.append("invocations_not_30")
        ids = []
    lifecycle_rows: list[dict[str, Any]] = []
    metadata_rows: list[dict[str, Any]] = []
    for invocation_id in ids:
        lifecycle = _load(root / "lifecycle" / f"{invocation_id}.json", accounting_failures, f"lifecycle_{invocation_id}")
        rows = lifecycle.get("rows", [])
        metadata = _load(root / "record-metadata" / f"{invocation_id}.json", accounting_failures, f"metadata_{invocation_id}")
        records = metadata.get("records", [])
        if not isinstance(rows, list) or len(rows) != BATCH_LIMIT:
            accounting_failures.append(f"lifecycle_rows_not_25:{invocation_id}")
        else:
            lifecycle_rows.extend(row for row in rows if isinstance(row, dict))
        if not isinstance(records, list) or len(records) != BATCH_LIMIT:
            accounting_failures.append(f"record_metadata_not_25:{invocation_id}")
        else:
            metadata_rows.extend(row for row in records if isinstance(row, dict))

    required = {
        "classification",
        "correlation_hash",
        "partition",
        "offset",
        "leader_broker_id",
        "selection_timestamp",
        "produce_timestamp",
        "broker_timestamp",
        "db_timestamp",
        "trace_id",
        "offset_provenance",
    }
    selected = sum(required <= set(row) for row in lifecycle_rows)
    produce = sum(bool(row.get("produce_timestamp")) for row in lifecycle_rows)
    broker = sum(bool(row.get("broker_timestamp")) for row in lifecycle_rows)
    database = sum(row.get("classification") == "DATABASE_ACKNOWLEDGED" and bool(row.get("db_timestamp")) for row in lifecycle_rows)
    leader = sum(
        isinstance(row.get("leader_broker_id"), int)
        and row.get("leader_snapshot_valid") is True
        for row in lifecycle_rows
    )
    primary_offsets = sum(row.get("primary") is True and isinstance(row.get("offset"), int) and bool(row.get("correlation_hash")) for row in metadata_rows)
    expected_rows = EXPECTED_INVOCATIONS * BATCH_LIMIT
    for name, count in {"selected": selected, "produce": produce, "broker": broker, "database": database, "leader": leader, "primary_record_metadata": primary_offsets}.items():
        if count != expected_rows:
            accounting_failures.append(f"{name}_rows:{count}/{expected_rows}")
    lifecycle_keys = [(row.get("correlation_hash"), row.get("partition"), row.get("offset")) for row in lifecycle_rows]
    metadata_keys = [(row.get("correlation_hash"), row.get("partition"), row.get("offset")) for row in metadata_rows]
    conflicting_duplicates = len(lifecycle_keys) - len(set(lifecycle_keys))
    if conflicting_duplicates:
        accounting_failures.append(f"conflicting_duplicates:{conflicting_duplicates}")
    if set(lifecycle_keys) != set(metadata_keys):
        accounting_failures.append("metadata_lifecycle_binding_mismatch")

    db_provenance = _audit_db_provenance(root, accounting_failures)

    start = _load(root / "window_start.json", audit_failures, "window_start")
    end = _load(root / "window_end.json", audit_failures, "window_end")
    expected_throughput = {
        "batch": BATCH_LIMIT,
        "interval_seconds": SCHEDULED_INTERVAL_S,
        "invocations": EXPECTED_INVOCATIONS,
    }
    if start.get("throughput_pin") != expected_throughput:
        accounting_failures.append("throughput_pin_mismatch")
    if start.get("force_flush") is not False:
        accounting_failures.append("force_flush_not_frozen_false")
    if start.get("throughput_change") is not False:
        accounting_failures.append("throughput_change_not_frozen_false")
    if start.get("runtime_pin") != end.get("runtime_pin") or not start.get("runtime_pin"):
        accounting_failures.append("runtime_pin_changed_or_missing")
    if start.get("historical_outbox_rows_mutated") != 0 or end.get("historical_outbox_rows_mutated") != 0:
        accounting_failures.append("historical_mutations_nonzero")
    preflight_sha = start.get("query_plane_preflight_sha256")
    try:
        frozen_preflight_sha = hashlib.sha256(
            (root / "query-plane-preflight.json").read_bytes()
        ).hexdigest()
        if frozen_preflight_sha != preflight_sha:
            trace_misses.append("query_plane_preflight_sha256_mismatch")
    except OSError as exc:
        trace_misses.append(f"query_plane_preflight_missing:{exc}")
    for final_path in (root / "traces").glob("*/final.meta.json"):
        final = _load(final_path, trace_misses, f"trace_{final_path.parent.name}")
        if final.get("query_plane_preflight_sha256") != preflight_sha:
            trace_misses.append(f"query_plane_hash_mismatch:{final_path.parent.name}")
        for attempt in final.get("attempts", []):
            if attempt.get("query_plane_preflight_sha256") != preflight_sha:
                trace_misses.append(f"attempt_query_plane_hash_mismatch:{final_path.parent.name}")

    baseline = _load(root / "observability" / "baseline.json", accounting_failures, "observability_baseline")
    post = _load(root / "observability" / "post_window.json", accounting_failures, "observability_post_window")
    stability = _load(root / "observability" / "stability-final.json", accounting_failures, "observability_stability")
    if stability.get("pass") is not True:
        accounting_failures.append("observability_stability_not_pass")
    for key in ("jaeger_restart_count", "jaeger_oomkill_count", "otel_collector_restart_count"):
        if baseline.get(key) != post.get(key):
            accounting_failures.append(f"{key}_growth_nonzero")

    passed = not trace_misses and not accounting_failures and not audit_failures
    return {
        "verdict": "PASS" if passed else "FAIL",
        "pass": passed,
        "exit_code": 0 if passed else 2,
        "trace_misses": trace_misses,
        "trace_failures": list(trace_misses),
        "accounting_failures": accounting_failures,
        "audit_failures": audit_failures,
        "db_provenance": db_provenance,
        "canary_root": str(root),
        "canary_done_present": done,
        "canary_incomplete_present": incomplete,
        "counts": {
            "invocations": f"{len(ids)}/{EXPECTED_INVOCATIONS}",
            "selected": f"{selected}/{expected_rows}",
            "produce": f"{produce}/{expected_rows}",
            "broker": f"{broker}/{expected_rows}",
            "database": f"{database}/{expected_rows}",
            "primary_record_metadata_offsets": f"{primary_offsets}/{expected_rows}",
            "leader_attributions": f"{leader}/{expected_rows}",
            "exact_traces": denominator.get("requested_trace_id_equals_response_trace_id", f"0/{EXPECTED_INVOCATIONS}"),
            "conflicting_duplicates": conflicting_duplicates,
        },
        "denominator": denominator,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--canary-root", type=Path)
    source.add_argument("--fixture", type=Path)
    parser.add_argument("--pre-done", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    root = Path(json.loads(args.fixture.read_text()).get("canary_root") or json.loads(args.fixture.read_text())["root"]) if args.fixture else args.canary_root
    result = audit_root(root, require_done=not args.pre_done)
    print(json.dumps(result, indent=2))
    return result["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
