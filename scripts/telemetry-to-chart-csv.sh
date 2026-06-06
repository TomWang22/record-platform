#!/usr/bin/env bash
# Convert preflight telemetry-during log to CSV for line charts (workload over time).
# Usage: ./scripts/telemetry-to-chart-csv.sh [telemetry-during-YYYYMMDD-HHMMSS.log]
#   With no arg, uses latest telemetry-during-*.log in repo root.
# Output: CSV with columns epoch_ts, iso_ts, inflight_requests, request_count (for Excel/Sheets line chart).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  INPUT=$(ls -t telemetry-during-*.log 2>/dev/null | head -1)
fi
if [[ -z "$INPUT" ]] || [[ ! -f "$INPUT" ]]; then
  echo "Usage: $0 [telemetry-during-YYYYMMDD-HHMMSS.log]" >&2
  echo "  Run preflight with PREFLIGHT_TELEMETRY=1 to generate telemetry-during-*.log, then run this script." >&2
  exit 1
fi

# Prometheus format: metric_name{labels} value  — value is last field. Sum inflight across labels; use count for request volume.
# Awk outputs: iso_ts, inflight_requests, request_count; we add epoch_ts in bash for portability (date -j on macOS, date -d on Linux).
echo "epoch_ts,iso_ts,inflight_requests,request_count"
awk '
/^=== [0-9T:-]+ ===/ {
  if (ts != "") { print ts "," inflight "," (count != "" ? count : ""); }
  ts = $2
  inflight = 0
  count = ""
  next
}
ts != "" && /^apiserver_current_inflight_requests/ {
  v = $NF
  if (v + 0 == v) inflight += v + 0
  next
}
ts != "" && /^apiserver_request_duration_seconds_count/ {
  v = $NF
  if (v + 0 == v) count = (count == "" ? v : count + v)
  next
}
ts != "" && /^apiserver_request_duration_seconds_sum/ && count == "" {
  v = $NF
  if (v + 0 == v) count = v
  next
}
END { if (ts != "") print ts "," inflight "," (count != "" ? count : ""); }
' "$INPUT" | while IFS= read -r line; do
  ts=$(echo "$line" | cut -d, -f1)
  epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null || date -d "$ts" +%s 2>/dev/null || echo "0")
  echo "$epoch,$line"
done
