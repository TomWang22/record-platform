#!/usr/bin/env python3
"""Independent auditor for archived canary-v3 read-only live probe artifacts.

Audits probe JSON + PROBED packet (+ PREPARED byte-equality evidence on PASS).
Never authorizes canary-v3 or flips acceptance flags. Fail-closed on malformed
inputs (never crash into an uncaught exception for artifact shape errors).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_DEFAULT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_DEFAULT / "scripts" / "lib"))

from auction_monitor_canary_v3_production_adapters import sha256_bytes  # noqa: E402

ALLOWED_VERDICTS = frozenset(
    {
        "READ_ONLY_LIVE_PROBE_PASS",
        "DB_PROVENANCE_NOT_READY",
        "LIVE_PROBE_OBSERVATIONS_INCOMPLETE",
        "PACKET_STATUS_TAMPER_ATTEMPT",
        "PACKET_VALIDATION_FAILED",
        "PACKET_NOT_PREPARED_NOT_AUTHORIZED",
        "HARNESS_PASS",
    }
)

FORBIDDEN_TRUE = (
    "execution_authorized",
    "live_window_authorized",
    "live_capture_acceptance_ready",
    "live_capture_armed_for_window",
    "a2_live_acceptance_ready",
    "canary_v3_execution_authorized",
    "canary_v3_window_executed",
    "finite_drain_experiment_armed",
    "maintenance_quiesce_v2_created",
    "gate5_ab_started",
    "gate5_v10_created",
    "gate6_authorized",
    "production_approved",
)

_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _base_report(*, failures: list[str], probe: dict[str, Any] | None = None) -> dict[str, Any]:
    probe = probe or {}
    passed = len(failures) == 0
    return {
        "schema": "canary-v3-live-readonly-probe-archive-audit/v1",
        "verdict": (
            "LIVE_PROBE_ARCHIVE_AUDIT_PASS"
            if passed
            else "LIVE_PROBE_ARCHIVE_AUDIT_FAIL"
        ),
        "probe_verdict": probe.get("verdict"),
        "read_only_live_probe_pass": bool(probe.get("read_only_live_probe_pass")),
        "prepared_packet_byte_equal": None,
        "live_window_authorized": False,
        "execution_authorized": False,
        "live_capture_acceptance_ready": False,
        "live_capture_armed_for_window": False,
        "a2_live_acceptance_ready": False,
        "canary_v3_execution_authorized": False,
        "canary_v3_window_executed": False,
        "finite_drain_experiment_armed": False,
        "maintenance_quiesce_v2_created": False,
        "gate5_ab_started": False,
        "gate5_v10_created": False,
        "gate6_authorized": False,
        "production_approved": False,
        "failures": failures,
        "note": (
            "Archive audit PASS validates posture of archived artifacts only. "
            "It does not authorize canary-v3 or flip acceptance flags."
        ),
    }


def _load_json_object(path: Path, failures: list[str], label: str) -> dict[str, Any]:
    if not path.is_file():
        failures.append(f"{label}:artifact_missing")
        return {}
    try:
        raw = path.read_text()
    except OSError as exc:
        failures.append(f"{label}:read_error:{exc}")
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        failures.append(f"{label}:malformed_json")
        return {}
    if not isinstance(payload, dict):
        failures.append(f"{label}:json_not_object")
        return {}
    return payload


def _verify_sidecar(path: Path, failures: list[str], label: str) -> str | None:
    sidecar = Path(f"{path}.sha256")
    if not path.is_file():
        failures.append(f"{label}:artifact_missing")
        return None
    if not sidecar.is_file():
        failures.append(f"{label}:sha256_sidecar_missing")
        return None
    try:
        text = sidecar.read_text().strip()
    except OSError as exc:
        failures.append(f"{label}:sha256_sidecar_read_error:{exc}")
        return None
    declared = text.split()[0] if text else ""
    if not declared or not _SHA256_RE.match(declared):
        failures.append(f"{label}:sha256_sidecar_malformed")
        return None
    actual = sha256_bytes(path.read_bytes()).lower()
    if actual != declared.lower():
        failures.append(f"{label}:sha256_mismatch")
        return None
    return actual


def audit_live_probe_archive(
    *,
    probe_path: Path,
    probed_packet_path: Path,
    prepared_packet_path: Path | None = None,
    prepared_sha_before: str | None = None,
    require_prepared_for_pass: bool = True,
) -> dict[str, Any]:
    failures: list[str] = []

    _verify_sidecar(probe_path, failures, "probe")
    _verify_sidecar(probed_packet_path, failures, "probed_packet")

    probe = _load_json_object(probe_path, failures, "probe")
    probed = _load_json_object(probed_packet_path, failures, "probed_packet")

    # If core artifacts are unreadable, stop with fail-closed report.
    if any(
        f.startswith(("probe:malformed_json", "probe:artifact_missing", "probe:json_not_object"))
        for f in failures
    ) and not probe:
        return _base_report(failures=failures, probe=probe)

    verdict = probe.get("verdict")
    if verdict not in ALLOWED_VERDICTS:
        failures.append(f"probe:unexpected_verdict:{verdict}")

    if probe.get("cluster_mutation_attempted") is not False:
        failures.append("probe:cluster_mutation_attempted")
    if probe.get("publisher_invocation_triggered") is not False:
        failures.append("probe:publisher_invocation_triggered")

    mutated = probe.get("outbox_rows_mutated", -1)
    if type(mutated) is not int or isinstance(mutated, bool):
        failures.append("probe:outbox_rows_mutated_not_int")
    elif mutated != 0:
        failures.append("probe:outbox_rows_mutated_nonzero")

    if probe.get("throughput_changed") is not False:
        failures.append("probe:throughput_changed")

    if probe.get("packet_status_unchanged") not in {
        None,
        "PREPARED_NOT_AUTHORIZED",
    }:
        if verdict in {
            "READ_ONLY_LIVE_PROBE_PASS",
            "DB_PROVENANCE_NOT_READY",
            "LIVE_PROBE_OBSERVATIONS_INCOMPLETE",
            "HARNESS_PASS",
        }:
            failures.append("probe:packet_status_unchanged_invalid")

    for key in FORBIDDEN_TRUE:
        if probe.get(key) is True:
            failures.append(f"probe:forbidden_true:{key}")
        if probed.get(key) is True:
            failures.append(f"probed:forbidden_true:{key}")

    # Option A: PROBED required for every terminal archive (including fail-closed).
    if probed.get("status") != "PREPARED_NOT_AUTHORIZED":
        failures.append("probed:status_not_prepared_not_authorized")
    if probed.get("live_window_authorized") is True:
        failures.append("probed:live_window_authorized_true")
    if probed.get("live_capture_acceptance_ready") is True:
        failures.append("probed:live_capture_acceptance_ready_true")
    if probed.get("live_capture_armed_for_window") is True:
        failures.append("probed:live_capture_armed_for_window_true")

    prepared_equal: bool | None = None

    if verdict == "READ_ONLY_LIVE_PROBE_PASS":
        if probe.get("read_only_live_probe_pass") is not True:
            failures.append("pass:read_only_live_probe_pass_false")
        dbp = probe.get("db_provenance") if isinstance(probe.get("db_provenance"), dict) else {}
        if dbp.get("status") != "READY":
            failures.append("pass:db_provenance_not_ready")
        if dbp.get("required_series_present") is not True:
            failures.append("pass:required_series_present_false")
        if dbp.get("auditor_recompute_pass") is not True:
            failures.append("pass:auditor_recompute_pass_false")
        if dbp.get("common_interval_proven") is not True:
            failures.append("pass:common_interval_proven_false")
        if dbp.get("counter_epoch_unchanged") is not True:
            failures.append("pass:counter_epoch_unchanged_false")
        if probe.get("prepared_packet_byte_equal_after") is not True:
            failures.append("pass:prepared_packet_byte_equal_after_not_true")

        if require_prepared_for_pass:
            if prepared_packet_path is None:
                failures.append("pass:prepared_packet_path_missing")
            else:
                if not prepared_packet_path.is_file():
                    failures.append("pass:prepared_artifact_missing")
                else:
                    after_digest = _verify_sidecar(
                        prepared_packet_path, failures, "prepared"
                    )
                    if not prepared_sha_before:
                        failures.append("pass:prepared_sha_before_missing")
                    elif not _SHA256_RE.match(str(prepared_sha_before)):
                        failures.append("pass:prepared_sha_before_malformed")
                    elif after_digest is not None:
                        prepared_equal = after_digest == str(prepared_sha_before).lower()
                        if not prepared_equal:
                            failures.append("prepared:byte_mutation_detected")
    else:
        if probe.get("read_only_live_probe_pass") is True:
            failures.append("fail_closed:claimed_pass_with_non_pass_verdict")
        # Optional PREPARED checks when caller supplies path/before for fail-closed archives.
        if prepared_packet_path is not None:
            if not prepared_packet_path.is_file():
                failures.append("prepared:artifact_missing")
            else:
                after_digest = _verify_sidecar(prepared_packet_path, failures, "prepared")
                if prepared_sha_before:
                    if not _SHA256_RE.match(str(prepared_sha_before)):
                        failures.append("prepared:sha_before_malformed")
                    elif after_digest is not None:
                        prepared_equal = after_digest == str(prepared_sha_before).lower()
                        if not prepared_equal:
                            failures.append("prepared:byte_mutation_detected")

    report = _base_report(failures=failures, probe=probe)
    report["prepared_packet_byte_equal"] = prepared_equal
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--probe",
        type=Path,
        default=REPO_DEFAULT / "reports/outbox/canary-v3-live-readonly-probe.json",
    )
    parser.add_argument(
        "--probed-packet",
        type=Path,
        default=REPO_DEFAULT
        / "reports/outbox/canary-v3-live-window-authorization-packet.PROBED.json",
    )
    parser.add_argument(
        "--prepared-packet",
        type=Path,
        default=None,
        help="Required for READ_ONLY_LIVE_PROBE_PASS audit; optional otherwise.",
    )
    parser.add_argument("--prepared-sha-before", type=str, default=None)
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO_DEFAULT
        / "reports/outbox/canary-v3-live-readonly-probe-archive-audit.json",
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    try:
        report = audit_live_probe_archive(
            probe_path=args.probe,
            probed_packet_path=args.probed_packet,
            prepared_packet_path=args.prepared_packet,
            prepared_sha_before=args.prepared_sha_before,
        )
    except Exception as exc:  # noqa: BLE001 — absolute fail-closed
        report = _base_report(failures=[f"auditor_internal_error:{type(exc).__name__}:{exc}"])

    raw = (json.dumps(report, indent=2, sort_keys=True) + "\n").encode()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(raw)
    Path(f"{args.out}.sha256").write_text(sha256_bytes(raw) + "\n")
    if not args.quiet:
        print(json.dumps(report, indent=2))
    return 0 if report["verdict"] == "LIVE_PROBE_ARCHIVE_AUDIT_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
