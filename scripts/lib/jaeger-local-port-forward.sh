# shellcheck shell=bash
# Source from verify-jaeger-*.sh: when JAEGER_QUERY_BASE points at loopback but nothing is
# listening, start kubectl port-forward to observability/jaeger (same pattern as bootstrap-trace-guarantee.sh).
#
# Env:
#   JAEGER_QUERY_BASE — required (read-only)
#   JAEGER_LIVENESS_AUTO_PORT_FORWARD — default 0 (disabled). Acceptance must use MetalLB Jaeger Query.
#     Set 1 only for local development — never for Gate 4 / bootstrap acceptance.
#   JAEGER_PF_NAMESPACE — default observability
#   JAEGER_PF_SERVICE — default jaeger
#   JAEGER_PF_LOCAL_PORT — local bind (default: port from JAEGER_QUERY_BASE or 16686)
#
# Sets: RP_JAEGER_PF_PID when a background port-forward was started (caller may kill on EXIT).

rp_jaeger_try_autopf() {
  RP_JAEGER_PF_PID=""
  [[ "${JAEGER_LIVENESS_AUTO_PORT_FORWARD:-0}" == "0" ]] && return 1
  [[ -z "${JAEGER_QUERY_BASE:-}" ]] && return 1
  command -v kubectl >/dev/null 2>&1 || return 1

  local base="${JAEGER_QUERY_BASE%/}"
  local hostport="${base#*://}"
  local host port
  if [[ "$hostport" == *:* ]]; then
    host="${hostport%%:*}"
    port="${hostport#*:}"
  else
    host="$hostport"
    port="16686"
  fi
  port="${port%%/*}"
  [[ "$host" == "127.0.0.1" || "$host" == "localhost" ]] || return 1

  if curl -sfS --max-time 3 "${base}/api/services" >/dev/null 2>&1; then
    return 0
  fi

  local ns="${JAEGER_PF_NAMESPACE:-observability}"
  local svc="${JAEGER_PF_SERVICE:-jaeger}"
  local local_port="${JAEGER_PF_LOCAL_PORT:-$port}"
  kubectl get svc "$svc" -n "$ns" --request-timeout=8s >/dev/null 2>&1 || return 1

  kubectl port-forward -n "$ns" "svc/$svc" "${local_port}:16686" --address=127.0.0.1 >/dev/null 2>&1 &
  RP_JAEGER_PF_PID=$!
  local _w
  for _w in $(seq 1 15); do
    sleep 1
    if curl -sfS --max-time 5 "${base}/api/services" >/dev/null 2>&1; then
      echo "Jaeger: started kubectl port-forward (pid ${RP_JAEGER_PF_PID}) → ${base}/api/services"
      return 0
    fi
  done
  kill "$RP_JAEGER_PF_PID" 2>/dev/null || true
  RP_JAEGER_PF_PID=""
  return 1
}
