#!/usr/bin/env bash
# Record Platform SLO/SLA gates for cold-bootstrap (JSON report + Prom export).
# Human logs → stderr; summary JSON → bench_logs/rp_slo_sla_report.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
mkdir -p "$REPO_ROOT/bench_logs"

NS="${RP_NAMESPACE:-${HOUSING_NS:-record-platform}}"
HOST="${RP_PUBLIC_HOST:-record-platform.test}"
SKIP_EDGE="${RP_SLO_SKIP_EDGE_PROBES:-0}"
STRICT="${RP_SLO_STRICT:-1}"

gates_app=0
gates_edge=0
gates_kafka=0
gates_transport=0
gates_obs=0
errors=()

log() { echo "$*" >&2; }

fail_gate() {
  errors+=("$1")
  log "❌ SLO gate failed: $1"
}

# --- app runtime (JSON must be parseable) ---
log "=== SLO: app runtime ==="
APP_JSON="$REPO_ROOT/bench_logs/app_runtime_latest.json"
if [[ -f "$APP_JSON" ]]; then
  if python3 -c "import json; d=json.load(open('$APP_JSON')); assert d.get('latency_percentiles_ms'), 'missing percentiles'; assert 'p95' in d['latency_percentiles_ms']" 2>/dev/null; then
    gates_app=1
    log "✅ app_runtime JSON + percentiles"
  else
    fail_gate "app_runtime: JSON missing p50/p95/p99/p100"
  fi
else
  log "ℹ️  running verify-app-runtime (capturing JSON)…"
  set +e
  json_out="$(HOUSING_NS="$NS" VERIFY_APP_RUNTIME_PHASE=cold VERIFY_APP_RUNTIME_PROM_OUT="$REPO_ROOT/bench_logs/app_runtime_metrics.prom" \
    bash "$SCRIPT_DIR/verify-app-runtime.sh" 2>/dev/null)"
  ec=$?
  set -e
  printf '%s\n' "$json_out" >"$APP_JSON"
  if [[ $ec -eq 0 ]] && python3 -c "import json; json.load(open('$APP_JSON'))" 2>/dev/null; then
    gates_app=1
    log "✅ app_runtime verify passed"
  else
    fail_gate "app_runtime: verify-app-runtime failed or non-JSON stdout"
  fi
fi

# --- edge latency (optional before /etc/hosts) ---
log "=== SLO: edge route latency ==="
if [[ "$SKIP_EDGE" == "1" ]]; then
  gates_edge=1
  log "ℹ️  RP_SLO_SKIP_EDGE_PROBES=1 — edge probes deferred until hosts updated"
else
  chmod +x "$SCRIPT_DIR/rp-probe-edge-route-latency.sh"
  if bash "$SCRIPT_DIR/rp-probe-edge-route-latency.sh" >/dev/null 2>&1; then
    gates_edge=1
    log "✅ edge route latency SLA"
  else
    fail_gate "edge_latency: rp-probe-edge-route-latency failed"
  fi
fi

# --- Kafka ---
log "=== SLO: Kafka TLS / topics ==="
NS="$NS" chmod +x "$SCRIPT_DIR/verify-kafka-ready.sh" 2>/dev/null || true
if [[ -x "$SCRIPT_DIR/verify-kafka-ready.sh" ]] && HOUSING_NS="$NS" bash "$SCRIPT_DIR/verify-kafka-ready.sh" >/dev/null 2>&1; then
  gates_kafka=1
  log "✅ Kafka brokers ready"
else
  fail_gate "kafka_tls: verify-kafka-ready failed"
fi
if kubectl get sts kafka -n "$NS" &>/dev/null; then
  for forbidden in dev.booking.events dev.social.events booking social; do
    if kubectl exec -n "$NS" kafka-0 -- kafka-topics --bootstrap-server kafka-0.kafka:9093 --list 2>/dev/null | grep -qi "$forbidden"; then
      fail_gate "kafka_topics: forbidden topic pattern $forbidden"
      gates_kafka=0
    fi
  done
fi

# --- transport invariants ---
log "=== SLO: transport invariants ==="
transport_ok=1
if ! kubectl get svc -n ingress-nginx caddy-h3 &>/dev/null; then
  transport_ok=0
  fail_gate "transport: caddy-h3 missing"
else
  stype="$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null || true)"
  if [[ "$stype" == "NodePort" ]]; then
    transport_ok=0
    fail_gate "transport: caddy-h3 must be LoadBalancer not NodePort"
  fi
  tcp443="$(kubectl get svc -n ingress-nginx caddy-h3 -o json 2>/dev/null | python3 -c "import json,sys; p=json.load(sys.stdin).get('spec',{}).get('ports',[]); print(next((x['port'] for x in p if x.get('port')==443 and x.get('protocol')=='TCP'), ''))" 2>/dev/null || true)"
  udp443="$(kubectl get svc -n ingress-nginx caddy-h3 -o json 2>/dev/null | python3 -c "import json,sys; p=json.load(sys.stdin).get('spec',{}).get('ports',[]); print(next((x['port'] for x in p if x.get('port')==443 and x.get('protocol')=='UDP'), ''))" 2>/dev/null || true)"
  [[ -n "$tcp443" ]] || { transport_ok=0; fail_gate "transport: TCP 443 missing on caddy-h3"; }
  [[ -n "$udp443" ]] || { transport_ok=0; fail_gate "transport: UDP 443 missing on caddy-h3"; }
fi
if [[ "$SKIP_EDGE" != "1" ]] && command -v curl >/dev/null 2>&1; then
  if curl --version 2>/dev/null | grep -qi http3; then
    log "ℹ️  curl supports HTTP/3 — edge h3 smoke runs with rp-probe-edge-route-latency"
  else
    log "ℹ️  curl without HTTP/3 — h3 smoke skipped (install curl with HTTP/3)"
  fi
fi
[[ $transport_ok -eq 1 ]] && gates_transport=1 && log "✅ transport invariants"

# --- observability ---
log "=== SLO: observability ==="
obs_ok=1
for dep in prometheus grafana jaeger otel-collector; do
  if kubectl get deploy -n observability "$dep" &>/dev/null 2>&1; then
    if ! kubectl get deploy -n observability "$dep" -o jsonpath='{.status.readyReplicas}' 2>/dev/null | grep -qE '^[1-9]'; then
      obs_ok=0
      fail_gate "observability: $dep not ready"
    fi
  fi
done
if [[ -d "$REPO_ROOT/infra/monitoring/grafana/dashboards" ]]; then
  if grep -ril 'record-platform\|RP \|housing tracker' "$REPO_ROOT/infra/monitoring/grafana/dashboards" 2>/dev/null | head -1 | grep -q .; then
    obs_ok=0
    fail_gate "observability: Grafana dashboard still has legacy title (not RP-named)"
  fi
fi
[[ $obs_ok -eq 1 ]] && gates_obs=1 && log "✅ observability stack"

REPORT="$REPO_ROOT/bench_logs/rp_slo_sla_report.json"
ERR_FILE="$(mktemp)"
printf '%s\n' "${errors[@]}" >"$ERR_FILE"
ERR_FILE="$ERR_FILE" python3 - "$REPORT" "$gates_app" "$gates_edge" "$gates_kafka" "$gates_transport" "$gates_obs" <<'PY'
import json, os, sys
err_path = os.environ.get("ERR_FILE", "")
errs = []
if err_path and os.path.isfile(err_path):
    errs = [ln.strip() for ln in open(err_path, encoding="utf-8") if ln.strip()]
gates = {
    "app_runtime": sys.argv[2] == "1",
    "edge_latency": sys.argv[3] == "1",
    "kafka_tls": sys.argv[4] == "1",
    "transport": sys.argv[5] == "1",
    "observability": sys.argv[6] == "1",
}
report = {
    "ok": not errs and all(gates.values()),
    "namespace": "record-platform",
    "gates": gates,
    "errors": errs,
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report))
PY
rm -f "$ERR_FILE"

chmod +x "$SCRIPT_DIR/rp-export-bootstrap-slo-prom.sh"
RP_APP_RUNTIME_JSON="$APP_JSON" bash "$SCRIPT_DIR/rp-export-bootstrap-slo-prom.sh" >/dev/null || true

if [[ "${#errors[@]}" -gt 0 ]] && [[ "$STRICT" == "1" ]]; then
  printf '%s\n' "${errors[@]}" >&2
  exit 1
fi
log "✅ rp-verify-slo-sla complete"
if [[ -f "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh" ]] && [[ "${RP_CB_SKIP_FINAL_SUMMARY:-0}" != "1" ]]; then
  export RP_CB_BENCH="$REPO_ROOT/bench_logs"
  export RP_CB_REPO_ROOT="$REPO_ROOT"
  # shellcheck source=scripts/lib/rp-cold-bootstrap-final-summary.sh
  source "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh" 2>/dev/null || true
  rp_cb_final_summary_print 2>/dev/null || true
fi
exit 0
