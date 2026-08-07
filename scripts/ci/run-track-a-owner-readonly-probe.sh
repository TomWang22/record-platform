#!/usr/bin/env bash
# Track A owner-attended read-only probe + archive audit.
# Does NOT authorize or execute canary-v3.
#
# Authorization semantics: ABSENT != AUTHORIZED.
# Fields must not be True; omitted fields are allowed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

EXPECTED_SHA="${TRACK_A_EXPECTED_SHA:?TRACK_A_EXPECTED_SHA must be set to the frozen Track A commit}"
EXPECTED_PREPARED_SHA="${TRACK_A_EXPECTED_PREPARED_SHA:?TRACK_A_EXPECTED_PREPARED_SHA must be set to the frozen PREPARED digest}"

ATTEMPT_ID="${TRACK_A_ATTEMPT_ID:-}"
EXPECTED_SUMMARY=""
if [[ -n "$ATTEMPT_ID" ]]; then
  OUT_DIR="reports/outbox/a2-attempts/${ATTEMPT_ID}"
  mkdir -p "$OUT_DIR"
  PREPARED="reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json"
  PROBED="${OUT_DIR}/canary-v3-live-window-authorization-packet.PROBED.json"
  PROBE="${OUT_DIR}/canary-v3-live-readonly-probe.json"
  AUDIT="${OUT_DIR}/canary-v3-live-readonly-probe-archive-audit.json"
  TRANSCRIPT="${OUT_DIR}/canary-v3-live-readonly-probe.transcript.log"
  SUMMARY="${OUT_DIR}/canary-v3-live-readonly-probe-owner-summary.json"
  EXPECTED_SUMMARY="${OUT_DIR}/canary-v3-live-readonly-probe-owner-summary.EXPECTED.jsonl"
else
  PREPARED="reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json"
  PROBED="reports/outbox/canary-v3-live-window-authorization-packet.PROBED.json"
  PROBE="reports/outbox/canary-v3-live-readonly-probe.json"
  AUDIT="reports/outbox/canary-v3-live-readonly-probe-archive-audit.json"
  TRANSCRIPT="reports/outbox/canary-v3-live-readonly-probe.transcript.log"
  SUMMARY="reports/outbox/canary-v3-live-readonly-probe-owner-summary.json"
fi

HEAD_SHA="$(git rev-parse HEAD)"
ORIGIN_SHA="$(git rev-parse origin/main)"
PREPARED_SHA_BEFORE="$(shasum -a 256 "$PREPARED" | awk '{print $1}')"

OWNER_RC=0
PROBE_RC=0
FIELD_RC=0
AUDIT_RC=0
POST_RC=0

if [[ "$HEAD_SHA" != "$EXPECTED_SHA" ]]; then
  echo "FAIL: HEAD=$HEAD_SHA expected=$EXPECTED_SHA" >&2
  OWNER_RC=2
fi

if [[ "$ORIGIN_SHA" != "$EXPECTED_SHA" ]]; then
  echo "FAIL: origin/main=$ORIGIN_SHA expected=$EXPECTED_SHA" >&2
  OWNER_RC=2
fi

if [[ "$PREPARED_SHA_BEFORE" != "$EXPECTED_PREPARED_SHA" ]]; then
  echo "FAIL: PREPARED sha=$PREPARED_SHA_BEFORE expected=$EXPECTED_PREPARED_SHA" >&2
  OWNER_RC=2
fi

python3 - "$PREPARED" <<'PY'
import json
import sys

path = sys.argv[1]
packet = json.load(open(path, encoding="utf-8"))


def assert_not_authorized(obj, key):
    assert obj.get(key) is not True, f"{key}=true"


assert packet["status"] == "PREPARED_NOT_AUTHORIZED", packet["status"]

for key in (
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
):
    assert_not_authorized(packet, key)

print("PREPARED_POSTURE_PASS")
PY

set +e
node scripts/ci/verify-track-a-owner-preflight.mjs
OWNER_PREFLIGHT_RC=$?
set -e
if [[ "$OWNER_PREFLIGHT_RC" -ne 0 ]]; then
  OWNER_RC=$OWNER_PREFLIGHT_RC
fi

# Fail closed if live-capture docker-plane API is called with a positional runner.
# capture_docker_execution_plane() is keyword-only (*, runner=...); zero-arg uses default runner.
python3 - <<'PY'
import ast
import inspect
import sys
from pathlib import Path

repo = Path.cwd()
sys.path.insert(0, str(repo / "scripts" / "lib"))
from auction_monitor_canary_v3_live_capture import capture_docker_execution_plane

sig = inspect.signature(capture_docker_execution_plane)
for name, param in sig.parameters.items():
    if param.kind not in (param.KEYWORD_ONLY, param.VAR_KEYWORD):
        raise SystemExit(f"FAIL: capture_docker_execution_plane param {name!r} is not keyword-only: {sig}")

probe_src = (repo / "scripts" / "run-auction-monitor-canary-v3-readonly-live-probe.py").read_text(
    encoding="utf-8"
)
tree = ast.parse(probe_src)
for node in ast.walk(tree):
    if not isinstance(node, ast.Call):
        continue
    func = node.func
    name = None
    if isinstance(func, ast.Name):
        name = func.id
    elif isinstance(func, ast.Attribute):
        name = func.attr
    if name != "capture_docker_execution_plane":
        continue
    if node.args:
        raise SystemExit(
            f"FAIL: positional args passed to capture_docker_execution_plane at line {node.lineno}"
        )
print("DOCKER_PLANE_CALL_SHAPE_PASS")
PY

{
  printf 'TRACK_A_MANUAL_READONLY_PROBE\n'
  printf 'started_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'head_sha=%s\n' "$HEAD_SHA"
  printf 'origin_sha=%s\n' "$ORIGIN_SHA"
  printf 'prepared_sha_before=%s\n' "$PREPARED_SHA_BEFORE"
  printf '\n'
} >"$TRANSCRIPT"

set +e
python3 scripts/run-auction-monitor-canary-v3-readonly-live-probe.py \
  --mode live \
  --packet "$PREPARED" \
  --out "$PROBE" \
  --probed-packet-out "$PROBED" \
  2>&1 | tee -a "$TRANSCRIPT"
PROBE_RC=${PIPESTATUS[0]}
set -e

PREPARED_SHA_AFTER="$(shasum -a 256 "$PREPARED" | awk '{print $1}')"

{
  printf '\nprobe_exit_code=%s\n' "$PROBE_RC"
  printf 'prepared_sha_after=%s\n' "$PREPARED_SHA_AFTER"
  printf 'prepared_byte_equal=%s\n' "$(
    [[ "$PREPARED_SHA_AFTER" == "$PREPARED_SHA_BEFORE" ]] && printf true || printf false
  )"
  printf 'finished_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >>"$TRANSCRIPT"

if [[ -n "$EXPECTED_SUMMARY" && -f "$EXPECTED_SUMMARY" ]]; then
  set +e
  python3 - "$PROBE" "$EXPECTED_SUMMARY" <<'PY'
import json
import sys
from pathlib import Path

probe_path, expected_path = sys.argv[1:]
probe = json.loads(Path(probe_path).read_text(encoding="utf-8"))
expected_doc = json.loads(Path(expected_path).read_text(encoding="utf-8").splitlines()[0])
shape = expected_doc.get("expected_if_db_busy") or {}

if probe.get("blocker") != shape.get("blocker"):
    print("EXPECTED_SUMMARY_SKIPPED:blocker_not_db_busy")
    raise SystemExit(0)

observed = {key: probe.get(key) for key in shape}
if observed != shape:
    print("FAIL: expected_summary_field_drift", file=sys.stderr)
    print(json.dumps({"expected": shape, "observed": observed}, indent=2), file=sys.stderr)
    raise SystemExit(2)

print("EXPECTED_SUMMARY_FIELD_CHECK_PASS")
PY
  FIELD_RC=$?
  set -e
fi

set +e
AUDIT_CMD=(
  python3 scripts/audit-canary-v3-live-readonly-probe-archive.py
  --probe "$PROBE"
  --probed-packet "$PROBED"
  --prepared-packet "$PREPARED"
  --prepared-sha-before "$PREPARED_SHA_BEFORE"
  --out "$AUDIT"
)
if [[ -n "$EXPECTED_SUMMARY" && -f "$EXPECTED_SUMMARY" ]]; then
  AUDIT_CMD+=(--expected-summary "$EXPECTED_SUMMARY")
fi
"${AUDIT_CMD[@]}"
AUDIT_RC=$?
set -e

python3 - "$PROBE" "$PROBED" "$AUDIT" "$HEAD_SHA" "$PROBE_RC" "$AUDIT_RC" "$SUMMARY" <<'PY'
import json
import sys
from pathlib import Path

probe_path, probed_path, audit_path, source_sha, probe_rc, audit_rc, summary_path = sys.argv[1:]

def load(path):
    p = Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))

probe = load(probe_path)
probed = load(probed_path)
audit = load(audit_path)

runtime = (probe.get("observed") or {}).get("runtime_pin") or {}
if not isinstance(runtime, dict):
    runtime = {}
if not runtime.get("RP_SOURCE_SHA"):
    observed = probe.get("observed") or {}
    for key in ("runtime_pin_t1", "runtime_pin_t0", "runtime_pin"):
        cand = observed.get(key)
        if isinstance(cand, dict) and cand.get("RP_SOURCE_SHA"):
            runtime = cand
            break

summary = {
    "source_sha": source_sha,
    "probe_exit_code": int(probe_rc),
    "probe_verdict": probe.get("verdict"),
    "read_only_live_probe_pass": probe.get("read_only_live_probe_pass"),
    "archive_auditor_exit_code": int(audit_rc),
    "archive_audit_verdict": audit.get("verdict"),
    "prepared_packet_byte_equal": audit.get("prepared_packet_byte_equal"),
    "probed_packet_status": probed.get("status"),
    "probe_failures": probe.get("failures") or probe.get("observation_gaps") or [],
    "audit_failures": audit.get("failures") or [],
    "runtime": {
        "RP_SOURCE_SHA": runtime.get("RP_SOURCE_SHA"),
        "image_digest": runtime.get("image_digest"),
        "pod_uid": runtime.get("pod_uid"),
        "pod_name": runtime.get("pod_name"),
    },
    "authorization": {
        "live_window_authorized": False,
        "canary_v3_execution_authorized": False,
        "canary_v3_window_executed": False,
        "finite_drain_experiment_armed": False,
        "maintenance_quiesce_v2_created": False,
        "gate5_ab_started": False,
        "gate5_v10_created": False,
        "gate6_authorized": False,
        "production_approved": False,
    },
}

print(json.dumps(summary, indent=2))
Path(summary_path).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
PY

PREPARED_SHA_FINAL="$(shasum -a 256 "$PREPARED" | awk '{print $1}')"
if [[ "$PREPARED_SHA_FINAL" != "$PREPARED_SHA_BEFORE" ]]; then
  echo "FAIL: PREPARED sha drifted: before=$PREPARED_SHA_BEFORE after=$PREPARED_SHA_FINAL" >&2
  POST_RC=2
fi

echo
echo "STOP: do not create an AUTHORIZED packet or start canary-v3."
echo "OWNER_RC=$OWNER_RC PROBE_RC=$PROBE_RC FIELD_RC=$FIELD_RC AUDIT_RC=$AUDIT_RC POST_RC=$POST_RC"

if [[ "$OWNER_RC" -ne 0 || "$PROBE_RC" -ne 0 || "$FIELD_RC" -ne 0 || "$AUDIT_RC" -ne 0 || "$POST_RC" -ne 0 ]]; then
  exit 2
fi
exit 0
