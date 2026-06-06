#!/usr/bin/env bash
# Run same k6 phases as run-k6-phases.sh but with xk6-http3 (HTTP/3). Requires built xk6 binary.
# Usage: SUITE_LOG_DIR=/tmp/suite K6_CA_ABSOLUTE=/path/to/ca.pem [K6_HTTP3_PHASES=read,soak,limit,max] ./scripts/load/run-k6-http3-phases.sh
# Called from run-k6-phases.sh when K6_HTTP3_PHASES=1, or run directly for HTTP/3-only phase run.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_DIR="$SCRIPT_DIR"

SUITE_LOG_DIR="${SUITE_LOG_DIR:-/tmp/k6-http3-phases}"
K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-}"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
BASE_URL="${BASE_URL:-https://${HOST}:${PORT}}"
# When caller passes K6_HTTP3_PHASES=1 (enable), treat as single "read" phase so one HTTP/3 phase runs
[[ "${K6_HTTP3_PHASES:-}" == "1" ]] && K6_HTTP3_PHASES="read"
[[ "${K6_HTTP3_PHASES:-}" == "yes" ]] && K6_HTTP3_PHASES="read"
K6_HTTP3_PHASES="${K6_HTTP3_PHASES:-read,soak,limit,max}"
K6_DURATION="${K6_DURATION:-30s}"
K6_SOAK_DURATION="${K6_SOAK_DURATION:-120s}"
K6_INSECURE="${K6_INSECURE_SKIP_TLS:-0}"

mkdir -p "$SUITE_LOG_DIR"
export SSL_CERT_FILE="${K6_CA_ABSOLUTE}"
k6_extra=()
[[ "$K6_INSECURE" == "1" || "$K6_INSECURE" == "true" ]] && k6_extra+=(--insecure-skip-tls-verify) || true

# Resolve xk6-http3 binary
K6_HTTP3_BIN=""
for candidate in "$REPO_ROOT/.k6-build/bin/k6-http3" "$REPO_ROOT/.k6-build/k6-http3"; do
  if [[ -x "$candidate" ]]; then K6_HTTP3_BIN="$candidate"; break; fi
done

if [[ -z "$K6_HTTP3_BIN" ]] || [[ ! -f "$LOAD_DIR/k6-http3-complete.js" ]]; then
  echo "⚠️  xk6-http3 not found (build: ./scripts/build-k6-http3.sh) or k6-http3-complete.js missing; skip HTTP/3 phases"
  exit 0
fi

echo "→ xk6 HTTP/3 phases: $K6_HTTP3_PHASES (binary: $K6_HTTP3_BIN)"

run_http3_phase() {
  local phase="$1"
  local duration="${2:-$K6_DURATION}"
  local log="$SUITE_LOG_DIR/k6-http3-${phase}.log"
  echo "  → k6 HTTP/3 phase: $phase (duration: $duration; log: $log)"
  ( export BASE_URL="$BASE_URL" HOST="$HOST" SSL_CERT_FILE="$K6_CA_ABSOLUTE" K6_PHASE="$phase" K6_DURATION="$duration"
    [[ -n "${K6_RESOLVE:-}" ]] && export K6_RESOLVE="$K6_RESOLVE"
    "$K6_HTTP3_BIN" run "${k6_extra[@]}" "$LOAD_DIR/k6-http3-complete.js" 2>&1 | tee "$log" ) || echo "  ⚠️  http3 phase $phase had issues"
}

IFS=',' read -ra PHASE_ARR <<< "$K6_HTTP3_PHASES"
for p in "${PHASE_ARR[@]}"; do
  p=$(echo "$p" | tr -d ' ')
  case "$p" in
    read)  run_http3_phase read "$K6_DURATION" ;;
    soak)  run_http3_phase soak "$K6_SOAK_DURATION" ;;
    sweep) run_http3_phase sweep 60s ;;
    limit) run_http3_phase limit 120s ;;
    max)   run_http3_phase max 180s ;;
    *)     echo "  ⚠️  unknown HTTP/3 phase: $p (skip)" ;;
  esac
done

echo "✅ xk6 HTTP/3 phases complete (logs in $SUITE_LOG_DIR)"
