#!/usr/bin/env bash
# Post a single Discord (or compatible) webhook message on bootstrap phase failure.
# Env: BOOTSTRAP_ALERT_WEBHOOK — URL (unset or empty → no-op exit 0).
# Optional: BOOTSTRAP_SKIP_ALERT=1 — skip send.
# Usage: notify-bootstrap-failure.sh <phase> [log_path]
set -euo pipefail
[[ "${BOOTSTRAP_SKIP_ALERT:-0}" == "1" ]] && exit 0

PHASE="${1:-unknown}"
LOG="${2:-}"

WEBHOOK="${BOOTSTRAP_ALERT_WEBHOOK:-}"
[[ -z "$WEBHOOK" ]] && exit 0

export RP_PHASE="$PHASE"
export RP_LOG="${LOG:-}"
export RP_HOST="$(hostname 2>/dev/null || echo unknown)"
export RP_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"

PAYLOAD="$(python3 <<'PY'
import json, os

lines = [
    "❌ Bootstrap FAILED",
    f"Phase: {os.environ.get("RP_PHASE', '')}",
    f"Log: {os.environ.get("RP_LOG') or '(none)'}",
    f"Host: {os.environ.get("RP_HOST', '')}",
    f"Time: {os.environ.get("RP_TS', '')}",
]
print(json.dumps({"content": "\n".join(lines)}))
PY
)"

curl -fsS -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" >/dev/null || true
