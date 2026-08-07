#!/usr/bin/env python3
"""Execution-gated canary-v3 runner. Environment values may only name frozen reports."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "lib"))

from auction_monitor_canary_v3_orchestrator import (  # noqa: E402
    main as orchestrator_main,
    run_canary_v3_window,
)
from auction_monitor_canary_v3_production_adapters import (  # noqa: E402
    LIVE_CAPTURE_ARMED_FOR_WINDOW,
    LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED,
    ProductionAdapterBundle,
    ProductionClusterIoForbidden,
)
from auction_monitor_canary_v3_live_capture import (  # noqa: E402
    LIVE_CAPTURE_ACCEPTANCE_READY,
)
from auction_monitor_canary_v3_trace import (  # noqa: E402
    BATCH_LIMIT,
    EXPECTED_INVOCATIONS,
    SCHEDULED_INTERVAL_S,
    QueryPlanePin,
    evaluate_execution_authorization_from_reports,
    evaluate_root_reuse_policy,
)

TRACE_CAPTURE_PRIMITIVES_IMPLEMENTED = True
# Read-only live capture implementations exist and are tested. Window arm and
# AUTHORIZED packet remain false; no live one-hour window has executed.
FULL_CANARY_V3_EXECUTION_HARNESS_IMPLEMENTED = False
THIRTY_INVOCATION_FIXTURE_ORCHESTRATION_IMPLEMENTED = True
LIVE_ONE_HOUR_SCHEDULING_IMPLEMENTED = True
DRY_RUN_SIDE_EFFECT_ISOLATION_ENFORCED = True
PUBLISHER_ACCOUNTING_EVIDENCE_MANDATORY_IN_AUDITOR = True
POST_WINDOW_OBSERVABILITY_STABILITY_CAPTURED = True
ROOT_OWNERSHIP_RACE_SAFE = True
QUERY_PLANE_THREE_STAGE_PREFLIGHT_COMPLETE = True
PRODUCTION_ADAPTERS_WIRED = True
LIVE_WINDOW_AUTHORIZATION_PACKET_PREPARED = True
LIVE_CAPTURE_IMPLEMENTATIONS_IMPLEMENTED = LIVE_CAPTURE_IMPLEMENTATIONS_ENABLED
CANARY_V3_WINDOW_EXECUTED = False
CANARY_DEFAULT = Path("/tmp/record-platform-auction-monitor-broker-ack-canary-v3")


def _constants() -> dict[str, bool]:
    return {
        "TRACE_CAPTURE_PRIMITIVES_IMPLEMENTED": TRACE_CAPTURE_PRIMITIVES_IMPLEMENTED,
        "FULL_CANARY_V3_EXECUTION_HARNESS_IMPLEMENTED": FULL_CANARY_V3_EXECUTION_HARNESS_IMPLEMENTED,
        "THIRTY_INVOCATION_FIXTURE_ORCHESTRATION_IMPLEMENTED": THIRTY_INVOCATION_FIXTURE_ORCHESTRATION_IMPLEMENTED,
        "LIVE_ONE_HOUR_SCHEDULING_IMPLEMENTED": LIVE_ONE_HOUR_SCHEDULING_IMPLEMENTED,
        "DRY_RUN_SIDE_EFFECT_ISOLATION_ENFORCED": DRY_RUN_SIDE_EFFECT_ISOLATION_ENFORCED,
        "PUBLISHER_ACCOUNTING_EVIDENCE_MANDATORY_IN_AUDITOR": PUBLISHER_ACCOUNTING_EVIDENCE_MANDATORY_IN_AUDITOR,
        "POST_WINDOW_OBSERVABILITY_STABILITY_CAPTURED": POST_WINDOW_OBSERVABILITY_STABILITY_CAPTURED,
        "ROOT_OWNERSHIP_RACE_SAFE": ROOT_OWNERSHIP_RACE_SAFE,
        "QUERY_PLANE_THREE_STAGE_PREFLIGHT_COMPLETE": QUERY_PLANE_THREE_STAGE_PREFLIGHT_COMPLETE,
        "PRODUCTION_ADAPTERS_WIRED": PRODUCTION_ADAPTERS_WIRED,
        "LIVE_WINDOW_AUTHORIZATION_PACKET_PREPARED": LIVE_WINDOW_AUTHORIZATION_PACKET_PREPARED,
        "LIVE_CAPTURE_IMPLEMENTATIONS_IMPLEMENTED": LIVE_CAPTURE_IMPLEMENTATIONS_IMPLEMENTED,
        "LIVE_CAPTURE_ACCEPTANCE_READY": LIVE_CAPTURE_ACCEPTANCE_READY,
        "LIVE_CAPTURE_ARMED_FOR_WINDOW": LIVE_CAPTURE_ARMED_FOR_WINDOW,
        "CANARY_V3_EXECUTION_AUTHORIZED": False,
        "CANARY_V3_WINDOW_EXECUTED": CANARY_V3_WINDOW_EXECUTED,
    }


def _authorization() -> tuple[dict, str | None, str | None, str]:
    authorization_path = os.environ.get("CANARY_V3_EXECUTION_AUTHORIZATION_REPORT")
    stability_path = os.environ.get("CANARY_V3_OBSERVABILITY_STABILITY_REPORT")
    runtime_sha = os.environ.get("CANARY_V3_EXPECTED_RUNTIME_SHA", "")
    if not authorization_path or not stability_path or not runtime_sha:
        return (
            {
                "status": "EXECUTION_REFUSED",
                "may_execute_window": False,
                "reason": "frozen_authorization_stability_reports_and_runtime_sha_required",
            },
            authorization_path,
            stability_path,
            runtime_sha,
        )
    return (
        evaluate_execution_authorization_from_reports(
            authorization_path, stability_path, runtime_sha
        ),
        authorization_path,
        stability_path,
        runtime_sha,
    )


def _refuse(reason: str, **extra: object) -> int:
    print(
        json.dumps(
            {
                "status": "EXECUTION_REFUSED",
                "reason": reason,
                **extra,
                **_constants(),
            },
            indent=2,
        )
    )
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canary-root", default=str(CANARY_DEFAULT))
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--execute-window", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--i-understand-live-window", action="store_true")
    parser.add_argument("--print-authorization", action="store_true")
    parser.add_argument("--check-immutable-root", action="store_true")
    parser.add_argument("--writer-id", default="canary-v3-runner")
    args = parser.parse_args(argv)
    if args.fixture:
        return orchestrator_main(["--fixture", str(args.fixture)])
    authorization, authorization_path, stability_path, runtime_sha = _authorization()
    authorization.update(
        _constants(),
        throughput_pin={
            "batch": BATCH_LIMIT,
            "interval_seconds": SCHEDULED_INTERVAL_S,
            "invocations": EXPECTED_INVOCATIONS,
        },
    )
    if args.print_authorization:
        print(json.dumps(authorization, indent=2))
        return 0
    if args.check_immutable_root:
        print(
            json.dumps(
                evaluate_root_reuse_policy(Path(args.canary_root), args.writer_id), indent=2
            )
        )
        return 0
    if not args.execute_window:
        return _refuse("WINDOW_NOT_EXECUTED", authorization=authorization)
    if not authorization["may_execute_window"]:
        return _refuse("frozen_reports_did_not_authorize", authorization=authorization)
    if args.live and not args.i_understand_live_window:
        return _refuse("live_window_requires_i_understand_live_window")
    fingerprints = (
        os.environ.get("CANARY_V3_JAEGER_LEAF_SHA256"),
        os.environ.get("CANARY_V3_JAEGER_INTERMEDIATE_SHA256"),
        os.environ.get("CANARY_V3_JAEGER_ROOT_SHA256"),
    )
    if not all(fingerprints):
        return _refuse("live_query_plane_three_fingerprint_pin_required")

    pin = QueryPlanePin(*fingerprints)
    if not args.live:
        return _refuse(
            "non_live_execute_window_requires_fixture_path",
            note="use --fixture for dry-run orchestration; live path requires production adapters",
        )

    packet_path = os.environ.get("CANARY_V3_LIVE_WINDOW_AUTHORIZATION_PACKET")
    if not packet_path:
        return _refuse("live_window_authorization_packet_required")

    # Cluster I/O stays off in this build. AUTHORIZED packet is still required to
    # construct the live adapter bundle; PREPARED packets refuse here.
    try:
        bundle = ProductionAdapterBundle(
            live_window_packet_path=packet_path,
            expected_runtime_sha=runtime_sha,
            query_plane_pin=pin,
            allow_cluster_io=False,
            require_packet_authorized=True,
            repo=REPO,
        )
    except (RuntimeError, ValueError, ProductionClusterIoForbidden) as exc:
        return _refuse(str(exc))

    result = run_canary_v3_window(
        root=Path(args.canary_root),
        authorization_report_path=authorization_path,
        stability_report_path=stability_path,
        expected_runtime_sha=runtime_sha,
        query_plane_pin=pin,
        writer_id=args.writer_id,
        dry_run=False,
        live_confirmed=True,
        fixture_mode=False,
        **bundle.orchestrator_hooks(),
    )
    result.update(_constants())
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "CANARY_DONE" else 2


if __name__ == "__main__":
    raise SystemExit(main())
