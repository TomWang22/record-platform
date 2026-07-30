#!/usr/bin/env bash
# After E2E / load, assert Jaeger has seen every Node service that bootstraps OpenTelemetry
# (matches services/*/src/otel-bootstrap.ts initTracing("<name>") — global instrumentation coverage).
# Per-vertical same-trace contracts: verify-jaeger-trace-structure.sh
#
# Requires JAEGER_QUERY_BASE — Jaeger query UI origin, e.g. http://<metallb-ip>:16686
#
# Env (optional):
#   JAEGER_SERVICES_VERIFY_ATTEMPTS — default 20 (poll /api/services until all required names appear).
#   JAEGER_SERVICES_VERIFY_SLEEP_SEC — default 2 (sleep between attempts; BatchSpanProcessor can lag after E2E).
set -euo pipefail

BASE="${JAEGER_QUERY_BASE:?Set JAEGER_QUERY_BASE (e.g. http://10.x.x.x:16686)}"
BASE="${BASE%/}"

_ATTEMPTS="${JAEGER_SERVICES_VERIFY_ATTEMPTS:-20}"
_SLEEP="${JAEGER_SERVICES_VERIFY_SLEEP_SEC:-2}"
_UI_READY_ATTEMPTS="${JAEGER_UI_READY_ATTEMPTS:-5}"
_UI_READY_SLEEP="${JAEGER_UI_READY_SLEEP_SEC:-2}"

tmp="$(mktemp)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

# Jaeger returns JSON with a "data" array of service names (keep in sync with otel-bootstrap service names).
required=(
  api-gateway
  auth-service
  reservation-mesh
  listings-service
  analytics-service
  messaging-service
  trust-service
  media-service
  notification-service
)

wait_for_jaeger_ui() {
  local i=1
  while [[ "$i" -le "$_UI_READY_ATTEMPTS" ]]; do
    if curl -sfS --max-time 10 "${BASE}/api/services" -o "$tmp"; then
      return 0
    fi
    if [[ "$i" -lt "$_UI_READY_ATTEMPTS" ]]; then
      sleep "$_UI_READY_SLEEP"
    fi
    i=$((i + 1))
  done
  echo "verify-jaeger-tracing-services: infra unavailable — Jaeger query endpoint unreachable: ${BASE}/api/services"
  echo "Hint: check Jaeger pod readiness/restarts and MetalLB routing before trace assertions."
  return 1
}

check_once() {
  missing=()
  curl -sfS --max-time 15 "${BASE}/api/services" -o "$tmp" || {
    echo "verify-jaeger-tracing-services: GET ${BASE}/api/services failed"
    return 1
  }
  for svc in "${required[@]}"; do
    if ! grep -qF "\"${svc}\"" "$tmp" && ! grep -qF "\"$svc\"" "$tmp"; then
      missing+=("$svc")
    fi
  done
  [[ ${#missing[@]} -eq 0 ]]
}

if ! wait_for_jaeger_ui; then
  exit 2
fi

_ok=0
for ((_i = 1; _i <= _ATTEMPTS; _i++)); do
  if check_once; then
    _ok=1
    break
  fi
  if [[ "$_i" -eq 1 ]]; then
    echo "verify-jaeger-tracing-services: incomplete (${#missing[@]} services missing); retrying up to ${_ATTEMPTS} polls (${_SLEEP}s apart) for OTLP batch export…"
  fi
  if [[ "$_i" -lt "$_ATTEMPTS" ]]; then
    sleep "$_SLEEP"
  fi
done

if [[ "$_ok" != "1" ]]; then
  echo "verify-jaeger-tracing-services: missing services in Jaeger after ${_ATTEMPTS} attempts: ${missing[*]}"
  echo "Response sample:"
  head -c 2000 "$tmp" || true
  echo
  exit 1
fi

echo "verify-jaeger-tracing-services: OK — Jaeger lists required services (${#required[@]} checked)"
