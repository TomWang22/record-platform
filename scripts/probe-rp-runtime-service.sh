#!/usr/bin/env bash
# Contract-driven runtime health probe (HTTP + optional gRPC) with loud diagnostics.
#
# Usage:
#   bash scripts/probe-rp-runtime-service.sh <service-name> [--mode http|grpc|both] [--verbose]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-runtime-health-contract.sh
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"

NS="${HOUSING_NS:-${NAMESPACE:-record-platform}}"
SERVICE="${1:-}"
shift || true
MODE="${RP_RUNTIME_PROBE_MODE:-}"
VERBOSE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --verbose) VERBOSE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$SERVICE" ]] || {
  echo "usage: probe-rp-runtime-service.sh <service> [--mode http|grpc|both] [--verbose]" >&2
  exit 2
}

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

if ! svc_json="$(rp_runtime_health_service_json "$SERVICE" 2>/dev/null)"; then
  echo "❌ unknown service in runtime contract: $SERVICE" >&2
  exit 1
fi

K8S_NAME="$(jq -r '.k8sName // .k8sService // .deployment // empty' <<<"$svc_json")"
[[ -n "$K8S_NAME" ]] || K8S_NAME="$SERVICE"
HTTP_PORT="$(jq -r '.httpPort // empty' <<<"$svc_json")"
GRPC_PORT="$(jq -r '.grpcPort // empty' <<<"$svc_json")"
HEALTH_PATH="$(jq -r '.healthPath // "/healthz"' <<<"$svc_json")"
READY_PATH="$(jq -r '.readyPath // .healthPath // "/healthz"' <<<"$svc_json")"
CONTRACT_MODE="$(jq -r '.runtimeHealthMode // "http"' <<<"$svc_json")"
TLS_POLICY="$(jq -r '.tlsPolicy // "plaintext"' <<<"$svc_json")"
GRPC_SVC="$(jq -r '.grpcService // ""' <<<"$svc_json")"
GRPC_TLS_NAME="$(jq -r '.grpcTlsServerName // .k8sName // .k8sService // empty' <<<"$svc_json")"
GRPC_REQUIRED="$(jq -r '.grpcRequiredForRuntime // false' <<<"$svc_json")"
GRPC_HEALTH_SUPPORTED="$(jq -r 'if .grpcHealthProbeSupported == false then "false" else "true" end' <<<"$svc_json")"
GRPC_OPTIONAL_REASON="$(jq -r '.grpcOptionalReason // ""' <<<"$svc_json")"
[[ -n "$MODE" ]] || MODE="$CONTRACT_MODE"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="${RP_RUNTIME_HEALTH_REPORT_DIR:-$REPO_ROOT/bench_logs/runtime-health/$TS/$SERVICE}"
SUMMARY="$REPORT_DIR/summary.json"
mkdir -p "$REPORT_DIR"

_log() {
  if [[ "$VERBOSE" -eq 1 ]]; then
    echo "$*"
  fi
  printf '%s\n' "$*" >>"$REPORT_DIR/probe.log"
}

_collect_k8s_debug() {
  local label="${K8S_NAME}"
  {
    echo "=== kubectl get deploy,po,svc,endpoints -l app=$label ==="
    kubectl get deploy,po,svc,endpoints -n "$NS" -l "app=$label" 2>&1 || true
    echo ""
    echo "=== kubectl logs deploy/$K8S_NAME --tail=120 ==="
    kubectl logs -n "$NS" "deploy/$K8S_NAME" --tail=120 --all-containers 2>&1 || true
    echo ""
    echo "=== kubectl describe pod -l app=$label ==="
    kubectl describe pod -n "$NS" -l "app=$label" 2>&1 | tail -80 || true
  } >"$REPORT_DIR/k8s-debug.txt" 2>&1
}

# Prefer readyPath for runtime gate; fall back to healthPath
PROBE_HTTP_PATH="$READY_PATH"
[[ "$PROBE_HTTP_PATH" == "null" || -z "$PROBE_HTTP_PATH" ]] && PROBE_HTTP_PATH="$HEALTH_PATH"

HTTP_URL_INPOD="http://127.0.0.1:${HTTP_PORT}${PROBE_HTTP_PATH}"
HTTP_URL_DNS="http://${K8S_NAME}.${NS}.svc.cluster.local:${HTTP_PORT}${PROBE_HTTP_PATH}"
GRPC_ADDR="localhost:${GRPC_PORT}"
GRPC_DNS="${K8S_NAME}.${NS}.svc.cluster.local:${GRPC_PORT}"

http_ok=0
grpc_ok=0
http_status="skip"
grpc_status="skip"
http_err=""
grpc_err=""
http_ms=0
grpc_ms=0
probe_pod="deploy/${K8S_NAME}"
PROBE_CONTAINER="${RP_PROBE_CONTAINER:-$(kubectl get deployment "$K8S_NAME" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || echo app)}"

_probe_http_inpod() {
  local url="$1" out="$2"
  local t0 t1
  t0="$(python3 -c 'import time; print(int(time.time()*1000))')"
  local gw_hdr=0
  [[ "$SERVICE" == "api-gateway" ]] && gw_hdr=1
  if kubectl -n "$NS" exec "deploy/$K8S_NAME" -c "$PROBE_CONTAINER" -- env HURL="$url" HM=12 HC=3 GW_HDR="$gw_hdr" sh -ec \
    'if command -v curl >/dev/null 2>&1; then
       if [ "$GW_HDR" = "1" ]; then
         curl -sS -w "\n%{http_code}" --connect-timeout "$HC" --max-time "$HM" -H "x-traffic-class: internal" "$HURL"
       else
         curl -sS -w "\n%{http_code}" --connect-timeout "$HC" --max-time "$HM" "$HURL"
       fi
     elif command -v wget >/dev/null 2>&1; then
       wget -q -O - --timeout="$HM" "$HURL"; echo; echo 200
     else
       exit 127
     fi' >"$out.body" 2>"$out.err"; then
    :
  else
    return 1
  fi
  t1="$(python3 -c 'import time; print(int(time.time()*1000))')"
  http_ms=$((t1 - t0))
  return 0
}

_probe_http_debug_pod() {
  local url="$1" out="$2"
  local pod="rp-probe-http-$$"
  local t0 t1
  t0="$(python3 -c 'import time; print(int(time.time()*1000))')"
  kubectl run "$pod" -n "$NS" --restart=Never --image=curlimages/curl:8.5.0 \
    --command -- sleep 120 >/dev/null 2>&1 || return 1
  kubectl wait -n "$NS" --for=condition=Ready "pod/$pod" --timeout=45s >/dev/null 2>&1 || true
  if kubectl exec -n "$NS" "$pod" -- \
    curl -sS -w "\n%{http_code}" --connect-timeout 3 --max-time 12 "$url" \
    >"$out.body" 2>"$out.err"; then
    probe_pod="pod/$pod"
    t1="$(python3 -c 'import time; print(int(time.time()*1000))')"
    http_ms=$((t1 - t0))
    kubectl delete pod "$pod" -n "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
    return 0
  fi
  kubectl delete pod "$pod" -n "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  return 1
}

_run_http() {
  [[ -z "$HTTP_PORT" || "$HTTP_PORT" == "null" ]] && return 0
  [[ "$MODE" == "grpc" ]] && return 0

  _log "▶ HTTP probe service=$SERVICE url_inpod=$HTTP_URL_INPOD url_dns=$HTTP_URL_DNS"

  local body="$REPORT_DIR/http"
  if _probe_http_inpod "$HTTP_URL_INPOD" "$body"; then
    probe_pod="deploy/${K8S_NAME}"
  elif _probe_http_inpod "$HTTP_URL_DNS" "$body"; then
    probe_pod="deploy/${K8S_NAME} (service DNS)"
  elif _probe_http_debug_pod "$HTTP_URL_DNS" "$body"; then
    :
  else
    http_status="error"
    http_err="no curl/wget in pod and debug pod failed"
    head -c 500 "$body.err" 2>/dev/null >>"$REPORT_DIR/http.stderr.txt" || true
    return 1
  fi

  http_status="$(awk 'END{print}' "$body.body" 2>/dev/null | tr -d '\r\n ' || echo 000)"
  [[ "$http_status" =~ ^[0-9]{3}$ ]] || http_status="000"
  sed '$d' "$body.body" 2>/dev/null | head -c 500 >"$REPORT_DIR/http.body.txt" || true
  cp "$body.err" "$REPORT_DIR/http.stderr.txt" 2>/dev/null || true

  _log "  HTTP target=$HTTP_URL_INPOD pod=$probe_pod status=$http_status elapsed_ms=$http_ms"
  if [[ "$VERBOSE" -eq 1 ]]; then
    echo "  HTTP GET $HTTP_URL_DNS (in-pod: $HTTP_URL_INPOD)"
    echo "  namespace=$NS probe_via=$probe_pod status=$http_status elapsed_ms=${http_ms}ms"
    echo "  body (first 500 chars):"
    head -c 500 "$REPORT_DIR/http.body.txt" 2>/dev/null || true
    echo ""
    [[ -s "$REPORT_DIR/http.stderr.txt" ]] && { echo "  stderr:"; cat "$REPORT_DIR/http.stderr.txt"; }
  fi

  if [[ "$http_status" =~ ^2 ]]; then
    http_ok=1
    return 0
  fi
  http_err="HTTP status $http_status"
  return 1
}

_run_grpc() {
  [[ -z "$GRPC_PORT" || "$GRPC_PORT" == "null" ]] && return 0
  [[ "$MODE" == "http" ]] && return 0

  local tls_flag=0
  [[ "$TLS_POLICY" == "service-mtls" ]] && tls_flag=1
  local sname="${GRPC_TLS_NAME:-$K8S_NAME}"
  local probe_bin="/usr/local/bin/grpc-health-probe"
  local t0 t1
  t0="$(python3 -c 'import time; print(int(time.time()*1000))')"

  local cmd_file="$REPORT_DIR/grpc-cmd.txt"
  if [[ "$tls_flag" -eq 1 ]]; then
    printf '%s -addr=%s -service=%s -tls -tls-no-verify=false -tls-ca-cert=/etc/certs/ca.crt -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key -tls-server-name=%s -connect-timeout=3s -rpc-timeout=12s\n' \
      "$probe_bin" "$GRPC_ADDR" "$GRPC_SVC" "$sname" >"$cmd_file"
    if kubectl -n "$NS" exec "deploy/$K8S_NAME" -c "$PROBE_CONTAINER" -- sh -ec "
      command -v $probe_bin >/dev/null 2>&1 || exit 127
      $probe_bin -addr=$GRPC_ADDR -service='$GRPC_SVC' -tls -tls-no-verify=false \
        -tls-ca-cert=/etc/certs/ca.crt -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key \
        -tls-server-name=$sname -connect-timeout=3s -rpc-timeout=12s
    " >"$REPORT_DIR/grpc.stdout.txt" 2>"$REPORT_DIR/grpc.stderr.txt"; then
      grpc_ok=1
      grpc_status=0
    else
      grpc_status=$?
      local stderr_snip=""
      if [[ -s "$REPORT_DIR/grpc.stderr.txt" ]]; then
        stderr_snip="$(head -c 500 "$REPORT_DIR/grpc.stderr.txt" | tr '\n' ' ')"
      fi
      grpc_err="grpc-health-probe exit $grpc_status target=${GRPC_ADDR} authority=${sname} service=${GRPC_SVC} ${stderr_snip:-no stderr}"
    fi
  else
    printf '%s -addr=%s -service=%s -connect-timeout=3s -rpc-timeout=12s\n' \
      "$probe_bin" "$GRPC_ADDR" "$GRPC_SVC" >"$cmd_file"
    if kubectl -n "$NS" exec "deploy/$K8S_NAME" -c "$PROBE_CONTAINER" -- sh -ec "
      command -v $probe_bin >/dev/null 2>&1 || exit 127
      $probe_bin -addr=$GRPC_ADDR -service='$GRPC_SVC' -connect-timeout=3s -rpc-timeout=12s
    " >"$REPORT_DIR/grpc.stdout.txt" 2>"$REPORT_DIR/grpc.stderr.txt"; then
      grpc_ok=1
      grpc_status=0
    else
      grpc_status=$?
      grpc_err="grpc-health-probe exit $grpc_status"
    fi
  fi
  t1="$(python3 -c 'import time; print(int(time.time()*1000))')"
  grpc_ms=$((t1 - t0))

  _log "▶ gRPC probe service=$SERVICE addr=$GRPC_DNS tls=$tls_flag server_name=$sname service=$GRPC_SVC"
  if [[ "$VERBOSE" -eq 1 ]]; then
    echo "  gRPC addr=$GRPC_DNS (in-pod $GRPC_ADDR) tls=$([[ $tls_flag -eq 1 ]] && echo mTLS || echo plaintext) authority=$sname"
    echo "  command: $(cat "$cmd_file")"
    echo "  exit=$grpc_status elapsed_ms=${grpc_ms}ms"
    [[ -s "$REPORT_DIR/grpc.stdout.txt" ]] && { echo "  stdout:"; cat "$REPORT_DIR/grpc.stdout.txt"; }
    [[ -s "$REPORT_DIR/grpc.stderr.txt" ]] && { echo "  stderr:"; cat "$REPORT_DIR/grpc.stderr.txt"; }
  fi
}

_run_http || true
_run_grpc || true

overall_ok=0
case "$MODE" in
  http)
    [[ "$http_ok" -eq 1 ]] && overall_ok=1
    ;;
  grpc)
    [[ "$grpc_ok" -eq 1 ]] && overall_ok=1
    ;;
  both|*)
    if [[ "$http_ok" -ne 1 ]]; then
      overall_ok=0
    elif [[ -n "$GRPC_PORT" && "$GRPC_PORT" != "null" && "$GRPC_REQUIRED" == "true" ]]; then
      [[ "$grpc_ok" -eq 1 ]] && overall_ok=1 || overall_ok=0
    else
      overall_ok=1
    fi
    ;;
esac

if [[ "$overall_ok" -ne 1 ]]; then
  _collect_k8s_debug
fi

if [[ "$overall_ok" -eq 1 ]]; then
  grpc_label="skip"
  if [[ -n "$GRPC_PORT" && "$GRPC_PORT" != "null" ]]; then
    if [[ "$grpc_ok" -eq 1 ]]; then
      grpc_label="SERVING"
    elif [[ -z "$GRPC_SVC" ]]; then
      grpc_label="SKIP_NO_SERVICE_NAME"
    elif [[ "$GRPC_HEALTH_SUPPORTED" == "false" ]]; then
      grpc_label="SKIP_NO_HEALTH_SVC(${GRPC_OPTIONAL_REASON:0:60})"
    elif { [[ "$grpc_err" == *NOT_SERVING* || "$grpc_err" == *"not serving"* || "$grpc_err" == *"service unhealthy"* ]] || \
           { [[ -f "$REPORT_DIR/grpc.stderr.txt" ]] && grep -qi 'NOT_SERVING\|service unhealthy' "$REPORT_DIR/grpc.stderr.txt" 2>/dev/null; }; }; then
      if [[ "$GRPC_REQUIRED" == "true" ]]; then grpc_label="NOT_SERVING"
      else grpc_label="NOT_SERVING(optional)"
      fi
    elif [[ "$GRPC_REQUIRED" == "true" ]]; then
      if [[ "$grpc_err" == *timeout* || "$grpc_err" == *Timeout* ]]; then grpc_label="timeout"
      else grpc_label="fail"
      fi
    else
      grpc_label="OPTIONAL_FAIL"
    fi
  fi
  http_label="${http_status:-ok}"
  [[ "$http_ok" -ne 1 ]] && http_label="${http_status:-fail}"
  runtime_verdict=pass
  jq -n \
  --arg service "$SERVICE" \
  --arg mode "$MODE" \
  --arg http_url "$HTTP_URL_DNS" \
  --arg grpc_addr "$GRPC_DNS" \
  --arg grpc_inpod "$GRPC_ADDR" \
  --arg tls_policy "$TLS_POLICY" \
  --arg grpc_tls_name "$GRPC_TLS_NAME" \
  --argjson http_ok "$http_ok" \
  --argjson grpc_ok "$grpc_ok" \
  --argjson grpc_inpod_ok "$grpc_ok" \
  --argjson grpc_dns_mtls_ok "$grpc_ok" \
  --arg http_status "$http_status" \
  --arg http_err "$http_err" \
  --arg grpc_err "$grpc_err" \
  --arg grpc_label "$grpc_label" \
  --arg http_label "$http_label" \
  --arg runtime_verdict "$runtime_verdict" \
  --argjson overall_ok "$overall_ok" \
  --arg report_dir "$REPORT_DIR" \
  '{
    service: $service,
    mode: $mode,
    http_url: $http_url,
    grpc_addr: $grpc_addr,
    grpc_inpod_addr: $grpc_inpod,
    tls_policy: $tls_policy,
    grpc_tls_server_name: $grpc_tls_name,
    http_ok: ($http_ok == 1),
    grpc_ok: ($grpc_ok == 1),
    grpc_inpod_mtls_ok: ($grpc_inpod_ok == 1),
    grpc_dns_mtls_ok: ($grpc_dns_mtls_ok == 1),
    http_status: $http_status,
    http_error: $http_err,
    grpc_error: $grpc_err,
    http_label: $http_label,
    grpc_label: $grpc_label,
    runtime_verdict: $runtime_verdict,
    ok: ($overall_ok == 1),
    report_dir: $report_dir
  }' >"$SUMMARY"
  if [[ "$grpc_ok" -ne 1 && -n "$GRPC_PORT" && "$GRPC_PORT" != "null" && "$GRPC_REQUIRED" != "true" ]]; then
    echo "⚠️  ${SERVICE} http=${http_label} grpc=${grpc_label} runtime=${runtime_verdict}"
  else
    echo "✅ ${SERVICE} http=${http_label} grpc=${grpc_label} runtime=${runtime_verdict}"
  fi
  exit 0
fi

grpc_label="fail"
if [[ -n "$GRPC_PORT" && "$GRPC_PORT" != "null" ]]; then
  if [[ -z "$GRPC_SVC" ]]; then grpc_label="SKIP_NO_SERVICE_NAME"
  elif [[ "$GRPC_HEALTH_SUPPORTED" == "false" ]]; then grpc_label="SKIP_NO_HEALTH_SVC"
  elif { [[ "$grpc_err" == *NOT_SERVING* || "$grpc_err" == *"service unhealthy"* ]] || \
         { [[ -f "$REPORT_DIR/grpc.stderr.txt" ]] && grep -qi 'NOT_SERVING\|service unhealthy' "$REPORT_DIR/grpc.stderr.txt" 2>/dev/null; }; }; then
    if [[ "$GRPC_REQUIRED" == "true" ]]; then grpc_label="NOT_SERVING"
    else grpc_label="NOT_SERVING(optional)"
    fi
  elif [[ "$GRPC_REQUIRED" != "true" ]]; then grpc_label="OPTIONAL_FAIL"
  elif [[ "$grpc_err" == *timeout* ]]; then grpc_label="timeout"
  else grpc_label="fail"
  fi
fi
http_label="${http_status:-?}"
runtime_verdict=fail
jq -n \
  --arg service "$SERVICE" \
  --arg mode "$MODE" \
  --arg http_url "$HTTP_URL_DNS" \
  --arg grpc_addr "$GRPC_DNS" \
  --arg grpc_inpod "$GRPC_ADDR" \
  --arg tls_policy "$TLS_POLICY" \
  --arg grpc_tls_name "$GRPC_TLS_NAME" \
  --argjson http_ok "$http_ok" \
  --argjson grpc_ok "$grpc_ok" \
  --argjson grpc_inpod_ok "$grpc_ok" \
  --argjson grpc_dns_mtls_ok "$grpc_ok" \
  --arg http_status "$http_status" \
  --arg http_err "$http_err" \
  --arg grpc_err "$grpc_err" \
  --arg grpc_label "$grpc_label" \
  --arg http_label "$http_label" \
  --arg runtime_verdict "$runtime_verdict" \
  --argjson overall_ok "$overall_ok" \
  --arg report_dir "$REPORT_DIR" \
  '{
    service: $service,
    mode: $mode,
    http_url: $http_url,
    grpc_addr: $grpc_addr,
    grpc_inpod_addr: $grpc_inpod,
    tls_policy: $tls_policy,
    grpc_tls_server_name: $grpc_tls_name,
    http_ok: ($http_ok == 1),
    grpc_ok: ($grpc_ok == 1),
    http_label: $http_label,
    grpc_label: $grpc_label,
    runtime_verdict: $runtime_verdict,
    ok: ($overall_ok == 1),
    report_dir: $report_dir
  }' >"$SUMMARY"

echo "❌ ${SERVICE} http=${http_label} grpc=${grpc_label} runtime=${runtime_verdict}" >&2
if [[ "$VERBOSE" -ne 1 ]]; then
  echo "  re-run: bash scripts/probe-rp-runtime-service.sh $SERVICE --mode $MODE --verbose" >&2
fi
exit 1
