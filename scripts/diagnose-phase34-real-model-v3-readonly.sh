#!/usr/bin/env bash
# File: scripts/diagnose-phase34-real-model-v3-readonly.sh
#
# Read-only terminal diagnosis for the active/terminated Phase 34 real-model v3.
# Writes analysis only outside the evidence root.

set -euo pipefail

ROOT="${PHASE34_V3_ROOT:-/tmp/phase34-real-model-full-eval-v3}"
ANALYSIS="${PHASE34_V3_ANALYSIS_ROOT:-/tmp/phase34-real-model-full-eval-v3-analysis}"
REPORT="${ANALYSIS}/terminal-diagnosis.json"

mkdir -p "$ANALYSIS"

if [[ ! -d "$ROOT" ]]; then
  printf 'Evidence root does not exist: %s\n' "$ROOT" >&2
  exit 2
fi

ROOT_CANONICAL="$(
  python3 - "$ROOT" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
)"

export ROOT ROOT_CANONICAL ANALYSIS REPORT

python3 <<'PY'
from __future__ import annotations

import collections
import datetime as dt
import hashlib
import json
import os
import pathlib
import subprocess
from typing import Any, Iterable

root = pathlib.Path(os.environ["ROOT"])
canonical_root = pathlib.Path(os.environ["ROOT_CANONICAL"])
analysis = pathlib.Path(os.environ["ANALYSIS"])
report_path = pathlib.Path(os.environ["REPORT"])

PASS_MARKER = "FROZEN_PASS_EVIDENCE"
BLOCKED_MARKER = "FROZEN_BLOCKED_EVIDENCE"


def iso_time(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return dt.datetime.fromtimestamp(
        timestamp,
        tz=dt.timezone.utc,
    ).isoformat().replace("+00:00", "Z")


def file_info(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "size": None,
            "mtime": None,
        }

    stat = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "size": stat.st_size,
        "mtime": iso_time(stat.st_mtime),
    }


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def list_exact_node_writers() -> list[dict[str, Any]]:
    result = run_command(
        ["ps", "-axo", "pid=,ppid=,lstart=,command="]
    )
    writers: list[dict[str, Any]] = []

    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        parts = line.split(maxsplit=8)
        if len(parts) < 9:
            continue

        pid_text, ppid_text = parts[0], parts[1]
        started = " ".join(parts[2:7])
        command = " ".join(parts[8:])

        command_lower = command.lower()
        is_node = (
            "/node " in command_lower
            or command_lower.startswith("node ")
            or "/node_modules/.bin/" in command_lower
        )

        references_root = (
            str(root) in command
            or str(canonical_root) in command
        )

        if not is_node or not references_root:
            continue

        writers.append(
            {
                "pid": int(pid_text),
                "ppid": int(ppid_text),
                "started": started,
                "command": command,
                "command_sha256": hashlib.sha256(
                    command.encode("utf-8")
                ).hexdigest(),
            }
        )

    return writers


def list_root_processes() -> list[dict[str, Any]]:
    result = run_command(["ps", "-axo", "pid=,ppid=,command="])
    processes: list[dict[str, Any]] = []

    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        parts = line.split(maxsplit=2)
        if len(parts) != 3:
            continue

        pid_text, ppid_text, command = parts
        if str(root) not in command and str(canonical_root) not in command:
            continue

        processes.append(
            {
                "pid": int(pid_text),
                "ppid": int(ppid_text),
                "command": command,
            }
        )

    return processes


def list_open_files() -> list[dict[str, Any]]:
    result = run_command(["lsof", "-n", "-P"])
    rows: list[dict[str, Any]] = []

    for line in result.stdout.splitlines():
        if str(root) not in line and str(canonical_root) not in line:
            continue

        parts = line.split()
        rows.append(
            {
                "raw": line,
                "command": parts[0] if parts else None,
                "pid": (
                    int(parts[1])
                    if len(parts) > 1 and parts[1].isdigit()
                    else None
                ),
            }
        )

    return rows


def iter_jsonl_files() -> Iterable[pathlib.Path]:
    yield from sorted(canonical_root.rglob("*.jsonl"))


def value_from_paths(
    row: dict[str, Any],
    paths: tuple[tuple[str, ...], ...],
) -> Any:
    for path_parts in paths:
        value: Any = row
        found = True

        for part in path_parts:
            if not isinstance(value, dict) or part not in value:
                found = False
                break
            value = value[part]

        if found and value is not None:
            return value

    return None


def normalize_identifier(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


session_paths = (
    ("session_id",),
    ("session", "session_id"),
    ("link", "session_id"),
)

turn_paths = (
    ("turn_id",),
    ("turn", "turn_id"),
    ("link", "turn_id"),
)

inference_paths = (
    ("inference_id",),
    ("model", "inference_id"),
    ("link", "inference_id"),
)

invocation_paths = (
    ("model_invocation_id",),
    ("invocation_id",),
    ("model", "model_invocation_id"),
)

failure_boolean_paths = (
    ("ok",),
    ("success",),
)

status_paths = (
    ("status",),
    ("result",),
    ("session_outcome",),
    ("acceptance_state",),
    ("execution_state",),
)

failure_statuses = {
    "FAIL",
    "FAILED",
    "BLOCKED",
    "ERROR",
    "TIMEOUT",
    "MODEL_TIMEOUT_EXHAUSTED",
    "FROZEN_BLOCKED_EVIDENCE",
}

session_counts: collections.Counter[str] = collections.Counter()
turn_counts: collections.Counter[str] = collections.Counter()
inference_counts: collections.Counter[str] = collections.Counter()
invocation_counts: collections.Counter[str] = collections.Counter()

jsonl_reports: list[dict[str, Any]] = []
failure_rows: list[dict[str, Any]] = []
malformed_rows = 0
total_rows = 0

for jsonl_path in iter_jsonl_files():
    file_rows = 0
    file_malformed = 0
    file_failures = 0

    try:
        relative_path = str(jsonl_path.relative_to(canonical_root))
    except ValueError:
        relative_path = str(jsonl_path)

    with jsonl_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            raw_line = raw_line.strip()
            if not raw_line:
                continue

            total_rows += 1
            file_rows += 1

            try:
                row = json.loads(raw_line)
            except json.JSONDecodeError:
                malformed_rows += 1
                file_malformed += 1
                continue

            if not isinstance(row, dict):
                continue

            session_id = normalize_identifier(
                value_from_paths(row, session_paths)
            )
            turn_id = normalize_identifier(
                value_from_paths(row, turn_paths)
            )
            inference_id = normalize_identifier(
                value_from_paths(row, inference_paths)
            )
            invocation_id = normalize_identifier(
                value_from_paths(row, invocation_paths)
            )

            if session_id:
                session_counts[session_id] += 1
            if turn_id:
                turn_counts[turn_id] += 1
            if inference_id:
                inference_counts[inference_id] += 1
            if invocation_id:
                invocation_counts[invocation_id] += 1

            row_failed = False

            for path_parts in failure_boolean_paths:
                value = value_from_paths(row, (path_parts,))
                if value is False:
                    row_failed = True

            status_value = value_from_paths(row, status_paths)
            if isinstance(status_value, str):
                if status_value.upper() in failure_statuses:
                    row_failed = True

            if any(
                key in row
                for key in (
                    "error",
                    "error_class",
                    "failure_class",
                    "hard_failure",
                )
            ):
                error_value = (
                    row.get("error")
                    or row.get("error_class")
                    or row.get("failure_class")
                    or row.get("hard_failure")
                )
                if error_value not in (None, "", False, [], {}):
                    row_failed = True

            if row_failed:
                file_failures += 1
                failure_rows.append(
                    {
                        "file": relative_path,
                        "line": line_number,
                        "row": row,
                    }
                )

    jsonl_reports.append(
        {
            "path": relative_path,
            "rows": file_rows,
            "malformed_rows": file_malformed,
            "failure_rows": file_failures,
            "bytes": jsonl_path.stat().st_size,
            "mtime": iso_time(jsonl_path.stat().st_mtime),
        }
    )


def duplicate_summary(
    counter: collections.Counter[str],
    limit: int = 100,
) -> dict[str, Any]:
    duplicates = {
        identifier: count
        for identifier, count in counter.items()
        if count > 1
    }

    ordered = sorted(
        duplicates.items(),
        key=lambda item: (-item[1], item[0]),
    )

    return {
        "distinct": len(counter),
        "duplicate_identifier_count": len(duplicates),
        "duplicate_extra_rows": sum(count - 1 for count in duplicates.values()),
        "sample": [
            {"id": identifier, "count": count}
            for identifier, count in ordered[:limit]
        ],
    }


pass_marker = canonical_root / PASS_MARKER
blocked_marker = canonical_root / BLOCKED_MARKER

marker_state: str
if pass_marker.exists() and blocked_marker.exists():
    marker_state = "BOTH_TERMINAL_MARKERS_PRESENT"
elif pass_marker.exists():
    marker_state = "FROZEN_PASS_EVIDENCE"
elif blocked_marker.exists():
    marker_state = "FROZEN_BLOCKED_EVIDENCE"
else:
    marker_state = "NO_TERMINAL_MARKER"

manifest_candidates = [
    path
    for path in sorted(canonical_root.rglob("*"))
    if path.is_file()
    and (
        "manifest" in path.name.lower()
        or path.name.upper() == "SHA256SUMS"
    )
]

manifest_infos = [file_info(path) for path in manifest_candidates]

terminal_marker_path: pathlib.Path | None = None
if marker_state == "FROZEN_PASS_EVIDENCE":
    terminal_marker_path = pass_marker
elif marker_state == "FROZEN_BLOCKED_EVIDENCE":
    terminal_marker_path = blocked_marker

marker_after_manifests: bool | None = None
if terminal_marker_path is not None and manifest_candidates:
    marker_mtime = terminal_marker_path.stat().st_mtime
    marker_after_manifests = all(
        marker_mtime >= path.stat().st_mtime
        for path in manifest_candidates
    )

writers = list_exact_node_writers()
root_processes = list_root_processes()
open_files = list_open_files()

if marker_state == "FROZEN_BLOCKED_EVIDENCE":
    classification = "TERMINAL_BLOCKED"
elif marker_state == "FROZEN_PASS_EVIDENCE":
    classification = "TERMINAL_PASS_CANDIDATE_REQUIRES_INDEPENDENT_VERIFY"
elif marker_state == "BOTH_TERMINAL_MARKERS_PRESENT":
    classification = "TERMINAL_MARKER_INTEGRITY_FAILURE"
elif len(writers) == 0:
    classification = "RUNNER_EXITED_WITHOUT_FREEZE"
else:
    classification = "RUNNING"

latest_failures = failure_rows[-20:]

# Also attach runner summary / freeze.json when present (read-only).
runner_summary = None
summary_path = canonical_root / "real-model-full-eval.json"
if summary_path.exists():
    try:
        runner_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        runner_summary = {"error": "malformed_real-model-full-eval.json"}

freeze_payload = None
freeze_path = blocked_marker / "freeze.json"
if freeze_path.exists():
    try:
        freeze_payload = json.loads(freeze_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        freeze_payload = {"error": "malformed_freeze.json"}

summary = {
    "schema_version": "phase34-v3-readonly-terminal-diagnosis-v1",
    "generated_at": dt.datetime.now(
        tz=dt.timezone.utc
    ).isoformat().replace("+00:00", "Z"),
    "evidence_root_input": str(root),
    "evidence_root_canonical": str(canonical_root),
    "analysis_root": str(analysis),
    "classification": classification,
    "terminal": {
        "state": marker_state,
        "pass_marker": file_info(pass_marker),
        "blocked_marker": file_info(blocked_marker),
        "blocked_freeze_json": freeze_payload,
        "runner_summary": {
            "ok": (runner_summary or {}).get("ok") if isinstance(runner_summary, dict) else None,
            "sessions_total": (runner_summary or {}).get("sessions_total") if isinstance(runner_summary, dict) else None,
            "hard_failure_count": (runner_summary or {}).get("hard_failure_count") if isinstance(runner_summary, dict) else None,
            "hard_failures": (runner_summary or {}).get("hard_failures") if isinstance(runner_summary, dict) else None,
            "eligibility_counters": (runner_summary or {}).get("eligibility_counters") if isinstance(runner_summary, dict) else None,
            "classification": (runner_summary or {}).get("classification") if isinstance(runner_summary, dict) else None,
        },
        "marker_after_manifests": marker_after_manifests,
        "manifest_candidates": manifest_infos,
    },
    "processes": {
        "exact_node_writer_count": len(writers),
        "exact_node_writers": writers,
        "root_scoped_process_count": len(root_processes),
        "root_scoped_processes": root_processes,
        "open_file_count": len(open_files),
        "open_files": open_files[:200],
    },
    "jsonl": {
        "file_count": len(jsonl_reports),
        "total_rows": total_rows,
        "malformed_rows": malformed_rows,
        "files": jsonl_reports,
    },
    "identities": {
        "sessions": duplicate_summary(session_counts),
        "turns": duplicate_summary(turn_counts),
        "inferences": duplicate_summary(inference_counts),
        "model_invocations": duplicate_summary(invocation_counts),
    },
    "failures": {
        "detected_rows": len(failure_rows),
        "latest": latest_failures,
    },
    "required_next_action": {
        "TERMINAL_BLOCKED": (
            "Preserve v3 unchanged. Extract the exact failure and perform RCA "
            "outside the root. Never resume this root."
        ),
        "TERMINAL_PASS_CANDIDATE_REQUIRES_INDEPENDENT_VERIFY": (
            "Run full independent count, model, retrieval, claim, protocol, "
            "freeze-order, and hash verification before accepting PASS."
        ),
        "TERMINAL_MARKER_INTEGRITY_FAILURE": (
            "Preserve the root and classify evidence integrity failure. "
            "Do not choose one marker."
        ),
        "RUNNER_EXITED_WITHOUT_FREEZE": (
            "Preserve the incomplete root. Do not create a marker manually and "
            "do not restart into this root. Repair the launcher and use a new root."
        ),
        "RUNNING": (
            "Continue read-only monitoring. Do not attach another writer."
        ),
    }[classification],
}

temporary_path = report_path.with_suffix(".json.tmp")
temporary_path.write_text(
    json.dumps(summary, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
os.replace(temporary_path, report_path)

print(json.dumps(summary, indent=2, sort_keys=True))
PY

printf '\nDiagnosis written outside evidence root:\n%s\n' "$REPORT"

python3 - "$REPORT" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    report = json.load(handle)

print("\n=== PHASE 34 V3 READ-ONLY VERDICT ===")
print(f"classification: {report['classification']}")
print(
    "terminal marker:",
    report["terminal"]["state"],
)
print(
    "exact Node writers:",
    report["processes"]["exact_node_writer_count"],
)
print(
    "failure rows:",
    report["failures"]["detected_rows"],
)
print(
    "distinct sessions:",
    report["identities"]["sessions"]["distinct"],
)
print(
    "duplicate session IDs:",
    report["identities"]["sessions"]["duplicate_identifier_count"],
)
print(
    "distinct model invocations:",
    report["identities"]["model_invocations"]["distinct"],
)
print(
    "duplicate model invocation IDs:",
    report["identities"]["model_invocations"]["duplicate_identifier_count"],
)
print("next action:", report["required_next_action"])
PY
