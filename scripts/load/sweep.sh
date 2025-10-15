#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://nginx:8080}"
EMAIL="${EMAIL:-t@t.t}"
PASS="${PASS:-p@ssw0rd}"
RATES=(${RATES:-200 300 400 600})
DURATION="${DURATION:-20s}"
VUS="${VUS:-50}"
SYNTH_IP="${SYNTH_IP:-1}"
ACCEPT_429="${ACCEPT_429:-1}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

token() {
  EMAIL="$EMAIL" PASS="$PASS" bash "$root/scripts/load/get-token.sh"
}

run_step() {
  local rate="$1" token="$2" out="$root/scripts/load/out-summary-${rate}.json"
  mkdir -p "$root/scripts/load"
  docker run --rm --network record-platform_default -v "$root:/work" -w /work \
    -e BASE_URL="$BASE_URL" -e TOKEN="$token" \
    -e RATE="$rate" -e VUS="$VUS" -e DURATION="$DURATION" \
    -e ACCEPT_429="$ACCEPT_429" -e SYNTH_IP="$SYNTH_IP" \
    grafana/k6:latest run --summary-export "/work/scripts/load/out-summary-${rate}.json" \
    /work/scripts/load/k6-reads.js >/dev/null
  # Parse summary JSON with a tiny python in container (no host deps)
  docker run --rm -v "$root:/work" python:3.11-alpine sh -lc "
python - <<'PY'
import json,sys
j=json.load(open('/work/scripts/load/out-summary-${rate}.json'))
lat=j['metrics']['http_req_duration']['percentiles']
err=j['metrics'].get('http_req_failed',{}).get('rate',0.0)
print(f'{rate},{lat.get(\"p(95)\",0)},{lat.get(\"p(99)\",0)},{err:.4f}')
PY
"
}

main() {
  tok="$(token)"
  echo "RATE,p95(ms),p99(ms),error_rate"
  for r in "${RATES[@]}"; do
    run_step "$r" "$tok"
  done
}
main