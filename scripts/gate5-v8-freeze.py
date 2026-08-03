#!/usr/bin/env python3
"""Freeze Gate 5 v8 evidence root on hard failure (no repair inside v8)."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("RP_GATE5_V8_ROOT", "/tmp/record-platform-runtime-heartbeat-gate5-v8"))


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    reason = os.environ.get("RP_GATE5_V8_FREEZE_REASON", "unspecified")
    detail = os.environ.get("RP_GATE5_V8_FREEZE_DETAIL", "")
    phase = os.environ.get("RP_GATE5_V8_FREEZE_PHASE", "unknown")
    ROOT.mkdir(parents=True, exist_ok=True)
    hard = {
        "document": "HARD_FAILURE",
        "ts": utc(),
        "phase": phase,
        "reason": reason,
        "detail": detail,
        "gate5_final_pass": False,
        "gate6_authorized": False,
        "remediation": "remediate outside this root; create gate5-v9 only after remediation + CI + runtime revalidation",
    }
    (ROOT / "HARD_FAILURE.json").write_text(json.dumps(hard, indent=2) + "\n")
    frozen = {
        "document": "FROZEN_BLOCKED_EVIDENCE",
        "ts": utc(),
        "state": "FROZEN_BLOCKED_EVIDENCE",
        "classification": reason,
        "phase": phase,
        "evidence_root": str(ROOT),
        "gate5_final_pass": False,
        "gate6_authorized": False,
        "pre_performance_gate_earned": False,
        "production_approved": False,
        "evidence_complete_pass": False,
    }
    (ROOT / "FROZEN_BLOCKED_EVIDENCE.json").write_text(json.dumps(frozen, indent=2) + "\n")
    status = ROOT / "STATUS.json"
    if status.exists():
        os.chmod(status, 0o644)
    status.write_text(
        json.dumps(
            {
                "document": "STATUS",
                "ts": utc(),
                "state": "FROZEN_BLOCKED_EVIDENCE",
                "hard_failure_phase": phase,
                "hard_failure_reason": reason,
                "gate5_final_pass": False,
                "gate6_authorized": False,
                "pre_performance_gate_earned": False,
                "production_approved": False,
                "evidence_complete_pass": False,
            },
            indent=2,
        )
        + "\n"
    )
    print(json.dumps(hard, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
