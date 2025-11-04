#!/usr/bin/env bash
set -euo pipefail

NS_APP=record-platform
NS_MON=monitoring

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; NC='\033[0m'
pass(){ echo -e "${GRN}PASS${NC} $*"; }
fail(){ echo -e "${RED}FAIL${NC} $*"; exit 1; }
info(){ echo -e "${YLW}INFO${NC}  $*"; }

need() { command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"; }
need kubectl
curl -sSf https://example.com >/dev/null 2>&1 || true # warm DNS cache for curl timing

# 1) Services exist, each has app label AND a port named "http"
info "Checking Services in namespace ${NS_APP}…"
kubectl get ns "${NS_APP}" >/dev/null 2>&1 || fail "Namespace ${NS_APP} not found"
SVC_JSON=$(kubectl -n "${NS_APP}" get svc -o json)
COUNT=$(echo "$SVC_JSON" | jq -r '.items | length' 2>/dev/null || echo 0)
[ "$COUNT" -gt 0 ] || fail "No Services found in ${NS_APP}"
MISSING_LABEL=$(echo "$SVC_JSON" | jq -r '.items[] | select(.metadata.labels.app == null) | .metadata.name' 2>/dev/null || true)
[ -z "${MISSING_LABEL}" ] || fail "Services missing label .metadata.labels.app: ${MISSING_LABEL}"
BAD_HTTP=$(echo "$SVC_JSON" | jq -r '.items[] | select([.spec.ports[].name] | index("http") | not) | .metadata.name' 2>/dev/null || true)
[ -z "${BAD_HTTP}" ] || fail "Services missing port named 'http': ${BAD_HTTP}"
pass "All Services have app label and an 'http' port"

# 2) ServiceMonitors exist
info "Checking ServiceMonitors in ${NS_MON}…"
kubectl get ns "${NS_MON}" >/dev/null 2>&1 || fail "Namespace ${NS_MON} not found"
kubectl -n "${NS_MON}" get servicemonitors >/dev/null 2>&1 || fail "No ServiceMonitor CRD or none found"
kubectl -n "${NS_MON}" get servicemonitors node-services edge-exporters >/dev/null 2>&1 || fail "Expected ServiceMonitors node-services and edge-exporters missing"
pass "ServiceMonitors present"

# Helper: background port-forward and clean up
PF_PIDS=()
pf_start() {
  local ns=$1; shift
  kubectl -n "$ns" port-forward "$@" >/dev/null 2>&1 &
  PF_PIDS+=($!)
  # small wait to bind
  for i in {1..20}; do sleep 0.2; kill -0 ${PF_PIDS[-1]} 2>/dev/null || fail "port-forward died"; done
}
pf_stop() { for p in "${PF_PIDS[@]:-}"; do kill "$p" >/dev/null 2>&1 || true; done; }

trap pf_stop EXIT

# 3) Prometheus targets UP (via kube-prometheus-stack)
info "Port-forwarding Prometheus svc…"
pf_start "${NS_MON}" svc/monitoring-kube-prometheus-prometheus 9090:9090
sleep 1
PROM=$(curl -fsS http://127.0.0.1:9090/api/v1/targets || true)
[[ "$PROM" == *"activeTargets"* ]] || fail "Prometheus API not responding on 9090"
# soft check: see node-services / edge-exporters pool or service labels
HAS_NODE=$(echo "$PROM" | grep -E '"node-services"|\"service\":\"api-gateway\"|\"service\":\"records-service\"' || true)
HAS_EDGE=$(echo "$PROM" | grep -E '"edge-exporters"|\"service\":\"nginx-exporter\"|\"service\":\"haproxy-exporter\"' || true)
[ -n "$HAS_NODE" ] || fail "Prometheus does not show node-services targets yet"
[ -n "$HAS_EDGE" ] || fail "Prometheus does not show edge-exporters targets yet"
pass "Prometheus shows node-services and edge-exporters"

# 4) NGINX health
info "Port-forwarding NGINX svc…"
pf_start "${NS_APP}" svc/nginx 8080:8080 8082:8082
sleep 0.5
curl -sf http://127.0.0.1:8080/healthz >/dev/null || fail "NGINX /healthz not OK on 8080"
pass "NGINX /healthz OK (8080)"

# 5) Grafana reachable
info "Port-forwarding Grafana svc…"
pf_start "${NS_MON}" svc/monitoring-grafana 3000:80
sleep 0.5
curl -sf http://127.0.0.1:3000/api/health | grep -q '"database":"ok"' || fail "Grafana /api/health not OK"
pass "Grafana is up (http://localhost:3000, admin / Admin123!)"

info "All checks passed ✅"
