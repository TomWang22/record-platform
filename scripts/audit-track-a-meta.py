#!/usr/bin/env python3
"""Track A meta-auditor — verifies A1/A2 CI reports and PREPARED packet hashes.

Does not authorize canary-v3, flip LIVE_CAPTURE_ACCEPTANCE_READY, or execute
a live cluster probe. Structural / harness PASS only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_DEFAULT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_DEFAULT / "scripts" / "lib"))

from auction_monitor_canary_v3_production_adapters import (  # noqa: E402
    compute_production_adapter_source_hashes,
    sha256_bytes,
)

FORBIDDEN_TRUE = (
    "execution_authorized",
    "gate5_ab_started",
    "gate5_v10_created",
    "gate6_authorized",
    "production_approved",
    "live_window_authorized",
    "canary_v3_execution_authorized",
    "canary_v3_window_executed",
    "finite_drain_experiment_armed",
    "maintenance_quiesce_v2_created",
)

REQUIRED_COUNTERS = (
    "auction_monitor_outbox_created_total",
    "auction_monitor_outbox_db_acknowledged_total",
    "auction_monitor_outbox_reopened_total",
    "auction_monitor_outbox_deleted_unpublished_total",
)

PROTOCOLS_EXPECTED = ["HTTP/1.1", "HTTP/2", "HTTP/3"]
POSTGRES_EXPECTED = 11


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _verify_sidecar(path: Path, failures: list[str]) -> None:
    sidecar = Path(f"{path}.sha256")
    if not path.is_file():
        failures.append(f"artifact_missing:{path}")
        return
    if not sidecar.is_file():
        failures.append(f"sha256_sidecar_missing:{path}")
        return
    actual = sha256_bytes(path.read_bytes())
    declared = sidecar.read_text().strip().split()[0]
    if actual != declared:
        failures.append(f"sha256_mismatch:{path}")


def _forbid_true_flags(payload: dict[str, Any], label: str, failures: list[str]) -> None:
    for key in FORBIDDEN_TRUE:
        if payload.get(key) is True:
            failures.append(f"{label}:forbidden_true:{key}")


def audit_track_a(
    *,
    repo: Path,
    ci_dir: Path,
) -> dict[str, Any]:
    failures: list[str] = []
    artifacts = {
        "denom_freeze": ci_dir / "denom-freeze.json",
        "a1": ci_dir / "track-a1-provenance-result.json",
        "a2": ci_dir / "track-a2-readonly-probe-result.json",
        "bundle": ci_dir / "track-a-exact-sha-bundle.json",
        "prepared_packet": repo
        / "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json",
    }

    for path in artifacts.values():
        _verify_sidecar(path, failures)

    denom = _load_json(artifacts["denom_freeze"]) if artifacts["denom_freeze"].is_file() else {}
    a1 = _load_json(artifacts["a1"]) if artifacts["a1"].is_file() else {}
    a2 = _load_json(artifacts["a2"]) if artifacts["a2"].is_file() else {}
    bundle = _load_json(artifacts["bundle"]) if artifacts["bundle"].is_file() else {}
    packet = (
        _load_json(artifacts["prepared_packet"])
        if artifacts["prepared_packet"].is_file()
        else {}
    )

    if denom.get("verdict") != "DENOM_FREEZE_PASS":
        failures.append("denom:verdict_not_pass")
    if int(denom.get("postgres_databases_expected") or 0) != POSTGRES_EXPECTED:
        failures.append("denom:postgres_databases_expected_mismatch")
    if list(denom.get("protocols_expected") or []) != PROTOCOLS_EXPECTED:
        failures.append("denom:protocols_expected_mismatch")
    if len(denom.get("postgres_databases") or []) != POSTGRES_EXPECTED:
        failures.append("denom:postgres_databases_length_mismatch")

    if a1.get("verdict") != "HARNESS_PASS":
        failures.append("a1:verdict_not_harness_pass")
    if a1.get("auditor_recompute_tests_pass") is not True:
        failures.append("a1:auditor_recompute_tests_pass_false")
    if a1.get("tamper_tests_pass") is not True:
        failures.append("a1:tamper_tests_pass_false")
    if list(a1.get("counters") or []) != list(REQUIRED_COUNTERS):
        failures.append("a1:counters_mismatch")
    if a1.get("acceptance_ready") is True:
        failures.append("a1:acceptance_ready_true")

    if a2.get("verdict") != "HARNESS_PASS":
        failures.append("a2:verdict_not_harness_pass")
    if a2.get("read_only_live_probe_pass") is not False:
        failures.append("a2:ci_claimed_live_probe_pass")
    if a2.get("real_cluster_probe_executed") is True:
        failures.append("a2:real_cluster_probe_executed")
    if a2.get("a2_live_acceptance_ready") is True:
        failures.append("a2:a2_live_acceptance_ready_true")
    if a2.get("cluster_mutation_attempted") is True:
        failures.append("a2:cluster_mutation_attempted")
    if a2.get("publisher_invocation_triggered") is True:
        failures.append("a2:publisher_invocation_triggered")

    if bundle.get("verdict") != "TRACK_A_CI_HARNESS_PASS":
        failures.append("bundle:verdict_not_pass")

    shas = {
        "denom": denom.get("exact_sha"),
        "a1": a1.get("exact_sha"),
        "a2": a2.get("exact_sha"),
        "bundle": bundle.get("exact_sha"),
    }
    if len({s for s in shas.values() if s}) != 1:
        failures.append(f"exact_sha_drift:{shas}")

    source_shas = a1.get("source_file_shas") or {}
    if not isinstance(source_shas, dict) or not source_shas:
        failures.append("a1:source_file_shas_missing")
    else:
        for rel, digest in source_shas.items():
            path = repo / rel
            if not path.is_file():
                failures.append(f"source_missing:{rel}")
                continue
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != digest:
                failures.append(f"source_sha_mismatch:{rel}")

    if packet.get("status") != "PREPARED_NOT_AUTHORIZED":
        failures.append("packet:status_not_prepared_not_authorized")
    if packet.get("live_window_authorized") is True:
        failures.append("packet:live_window_authorized_true")
    if packet.get("live_capture_acceptance_ready") is True:
        failures.append("packet:live_capture_acceptance_ready_true")
    if packet.get("live_capture_armed_for_window") is True:
        failures.append("packet:live_capture_armed_for_window_true")

    computed = compute_production_adapter_source_hashes(repo)
    frozen = packet.get("adapter_source_hashes") or {}
    for key, digest in computed.items():
        if frozen.get(key) != digest:
            failures.append(f"packet:adapter_source_hash_mismatch:{key}")

    for label, payload in (
        ("denom", denom),
        ("a1", a1),
        ("a2", a2),
        ("bundle", bundle),
        ("packet", packet),
    ):
        _forbid_true_flags(payload, label, failures)

    passed = len(failures) == 0
    report = {
        "schema": "track-a-meta-auditor-result/v1",
        "track": "A_META",
        "verdict": "TRACK_A_META_PASS" if passed else "TRACK_A_META_FAIL",
        "exact_sha": shas.get("bundle") or shas.get("a1"),
        "denominators_verified": "denom:postgres_databases_expected_mismatch" not in failures
        and "denom:protocols_expected_mismatch" not in failures,
        "postgres_databases_expected": POSTGRES_EXPECTED,
        "protocols_expected": list(PROTOCOLS_EXPECTED),
        "a1_verified": a1.get("verdict") == "HARNESS_PASS" and "a1:verdict_not_harness_pass" not in failures,
        "a2_verified": a2.get("verdict") == "HARNESS_PASS" and "a2:verdict_not_harness_pass" not in failures,
        "prepared_packet_hashes_verified": not any(
            f.startswith("packet:adapter_source_hash_mismatch") or f.startswith("sha256_mismatch:")
            for f in failures
        ),
        "source_file_shas_verified": not any(f.startswith("source_sha_mismatch:") for f in failures),
        "read_only_live_probe_pass": False,
        "live_window_authorized": False,
        "a2_live_acceptance_ready": False,
        "live_capture_acceptance_ready": False,
        "canary_v3_execution_authorized": False,
        "canary_v3_window_executed": False,
        "finite_drain_experiment_armed": False,
        "maintenance_quiesce_v2_created": False,
        "gate5_ab_started": False,
        "gate5_v10_created": False,
        "gate6_authorized": False,
        "production_approved": False,
        "execution_authorized": False,
        "failures": failures,
        "consumed_artifacts": [
            str(p.relative_to(repo)) if str(p).startswith(str(repo)) else str(p)
            for p in artifacts.values()
        ],
        "note": (
            "TRACK_A_META_PASS is harness/structure only. "
            "It does not accept a real cluster probe or authorize canary-v3."
        ),
    }
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=REPO_DEFAULT)
    parser.add_argument("--ci-dir", type=Path, default=None)
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    ci_dir = (args.ci_dir or (repo / "reports/ci")).resolve()
    out = (args.out or (ci_dir / "track-a-meta-auditor-result.json")).resolve()

    report = audit_track_a(repo=repo, ci_dir=ci_dir)
    raw = (json.dumps(report, indent=2, sort_keys=True) + "\n").encode()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    Path(f"{out}.sha256").write_text(sha256_bytes(raw) + "\n")
    if not args.quiet:
        print(json.dumps(report, indent=2))
    return 0 if report["verdict"] == "TRACK_A_META_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
