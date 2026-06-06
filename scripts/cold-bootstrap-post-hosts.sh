#!/usr/bin/env bash
# Post-hosts continuation after cold-bootstrap pauses at I.transport.
# Run after updating /etc/hosts for record-platform.test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export RP_CB_REPO_ROOT="$REPO_ROOT"
export RP_CB_BENCH="$REPO_ROOT/bench_logs"
export RP_CB_GRAPH="$REPO_ROOT/infra/bootstrap_invariants.graph.json"
export RP_CB_PROGRESS="$REPO_ROOT/bench_logs/bootstrap_state_progress.json"
export HOUSING_NS="${HOUSING_NS:-record-platform}"
export RP_PUBLIC_HOST="${RP_PUBLIC_HOST:-record-platform.test}"
export RP_CLUSTER_DOCTOR_MIN_SCORE="${RP_CLUSTER_DOCTOR_MIN_SCORE:-95}"

# shellcheck source=scripts/lib/rp-cold-bootstrap-lib.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-lib.sh"

export RP_CB_DRY_RUN=0
export RP_COLD_BOOTSTRAP_LOG="${RP_COLD_BOOTSTRAP_LOG:-/tmp/rp-cold-bootstrap-post-hosts.log}"
rp_cb_setup_log_tee

if [[ "${COLD_BOOTSTRAP_CONFIRM:-}" != "yes" ]]; then
  echo "❌ Set COLD_BOOTSTRAP_CONFIRM=yes" >&2
  exit 1
fi

if ! grep -q "${RP_PUBLIC_HOST}" /etc/hosts 2>/dev/null; then
  echo "❌ ${RP_PUBLIC_HOST} not in /etc/hosts — update hosts before post-hosts contract" >&2
  exit 1
fi

mkdir -p "$RP_CB_BENCH"
rp_cb_say "post-hosts" "J.final_contract — edge h2/h3 strict + contract matrix + runtime proof"
rp_cb_phase_enter J.final_contract

rp_cb_ensure_kube_api "before J.final_contract" || \
  rp_cb_phase_fail J.final_contract "kube API bridge align failed" "re-run: COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap-post-hosts"

chmod +x "$SCRIPT_DIR/audit-rp-metallb-only-edge.sh" \
  "$SCRIPT_DIR/smoke-rp-edge-http2-strict.sh" \
  "$SCRIPT_DIR/smoke-rp-edge-http3-strict.sh" \
  "$SCRIPT_DIR/smoke-rp-edge-h2-h3-strict-tls.sh" \
  "$SCRIPT_DIR/smoke-rp-edge-contract.sh" \
  "$SCRIPT_DIR/audit-rp-edge-host-contract.sh" \
  "$SCRIPT_DIR/probe-edge-route-latency.sh" \
  "$SCRIPT_DIR/verify-app-runtime.sh" \
  "$SCRIPT_DIR/audit-rp-grpc-health-source.sh" \
  "$SCRIPT_DIR/rca-rp-grpc-mtls.sh" \
  "$SCRIPT_DIR/audit-rp-service-mtls-required.sh" \
  "$SCRIPT_DIR/smoke-rp-mtls-real.sh" \
  "$SCRIPT_DIR/lib/rp-bootstrap-grpc-mtls-gate.sh" \
  "$SCRIPT_DIR/lib/rp-bootstrap-post-runtime-gates.sh" \
  "$SCRIPT_DIR/audit-rp-ollama-stack.sh" \
  "$SCRIPT_DIR/smoke-rp-ollama.sh" 2>/dev/null || true

export RP_CB_RUN_LABEL="audit-rp-metallb-only-edge"
rp_cb_run bash "$SCRIPT_DIR/audit-rp-metallb-only-edge.sh" || \
  rp_cb_phase_fail J.final_contract "MetalLB-only edge audit failed" "bash scripts/audit-rp-metallb-only-edge.sh"

export RP_CB_RUN_LABEL="smoke-rp-edge-http2-strict"
rp_cb_run bash "$SCRIPT_DIR/smoke-rp-edge-http2-strict.sh" || \
  rp_cb_phase_fail J.final_contract "HTTP/2 strict edge smoke failed" "bash scripts/smoke-rp-edge-http2-strict.sh"

export RP_CB_RUN_LABEL="smoke-rp-edge-http3-strict"
rp_cb_run bash "$SCRIPT_DIR/smoke-rp-edge-http3-strict.sh" || \
  rp_cb_phase_fail J.final_contract "HTTP/3 strict edge smoke failed" "bash scripts/smoke-rp-edge-http3-strict.sh"

export RP_CB_RUN_LABEL="smoke-rp-edge-contract"
rp_cb_run bash "$SCRIPT_DIR/smoke-rp-edge-contract.sh" || \
  rp_cb_phase_fail J.final_contract "edge endpoint contract smoke failed" "bash scripts/smoke-rp-edge-contract.sh"

export RP_CB_RUN_LABEL="audit-rp-edge-host-contract"
rp_cb_run bash "$SCRIPT_DIR/audit-rp-edge-host-contract.sh" || \
  rp_cb_phase_fail J.final_contract "edge host contract audit failed" "bash scripts/audit-rp-edge-host-contract.sh"

export RP_CB_RUN_LABEL="probe-edge-route-latency"
rp_cb_run bash "$SCRIPT_DIR/probe-edge-route-latency.sh" || \
  rp_cb_phase_fail J.final_contract "edge route latency SLA failed" "bash scripts/probe-edge-route-latency.sh"

export RP_CB_RUN_LABEL="smoke-rp-edge-h2-h3-strict-tls"
rp_cb_run bash "$SCRIPT_DIR/smoke-rp-edge-h2-h3-strict-tls.sh" || \
  rp_cb_phase_fail J.final_contract "H2/H3 strict TLS smoke failed" "bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh"

export RP_CB_RUN_LABEL="rp-bootstrap-grpc-mtls-gate"
# shellcheck source=lib/rp-bootstrap-grpc-mtls-gate.sh
rp_cb_run bash "$SCRIPT_DIR/lib/rp-bootstrap-grpc-mtls-gate.sh" || \
  rp_cb_phase_fail J.final_contract "gRPC mTLS required gate failed" "bash scripts/lib/rp-bootstrap-grpc-mtls-gate.sh"

export RP_CB_RUN_LABEL="verify-app-runtime (post-hosts)"
rp_cb_run env VERIFY_APP_RUNTIME_PHASE=cold HOUSING_NS="$HOUSING_NS" \
  bash "$SCRIPT_DIR/verify-app-runtime.sh" || \
  rp_cb_phase_fail J.final_contract "verify-app-runtime failed" "VERIFY_APP_RUNTIME_PHASE=cold bash scripts/verify-app-runtime.sh"

export RP_CB_RUN_LABEL="rp-bootstrap-post-runtime-gates (kafka/redis/outbox)"
rp_cb_run bash "$SCRIPT_DIR/lib/rp-bootstrap-post-runtime-gates.sh" || \
  rp_cb_phase_fail J.final_contract "post-runtime kafka/redis gates failed" "bash scripts/lib/rp-bootstrap-post-runtime-gates.sh"

export RP_CB_RUN_LABEL="audit-rp-grpc-health-source"
rp_cb_run bash "$SCRIPT_DIR/audit-rp-grpc-health-source.sh" || \
  rp_cb_phase_fail J.final_contract "audit-rp-grpc-health-source failed" "bash scripts/audit-rp-grpc-health-source.sh"

if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE:-1}" == "1" ]]; then
  export RP_CB_RUN_LABEL="apply-ollama-metallb-lb"
  rp_cb_run bash "$SCRIPT_DIR/apply-ollama-metallb-lb.sh" 2>/dev/null || true
  export RP_CB_RUN_LABEL="audit-rp-ollama-stack"
  rp_cb_run bash "$SCRIPT_DIR/audit-rp-ollama-stack.sh" || \
    rp_cb_phase_fail J.final_contract "audit-rp-ollama-stack failed" "bash scripts/audit-rp-ollama-stack.sh"
  export RP_CB_RUN_LABEL="smoke-rp-ollama"
  rp_cb_run bash "$SCRIPT_DIR/smoke-rp-ollama.sh" || \
    rp_cb_phase_fail J.final_contract "smoke-rp-ollama failed" "bash scripts/smoke-rp-ollama.sh"
else
  rp_cb_ok "Ollama stack skipped (core-only)"
fi

make -C "$REPO_ROOT" rp-preflight-network-contract || \
  rp_cb_phase_fail J.final_contract "rp-preflight-network-contract failed" "make rp-preflight-network-contract"

VERIFY_BOOTSTRAP_HTTP3_EDGE=1 HOUSING_NS="$HOUSING_NS" VERIFY_BOOTSTRAP_CONTEXT=post-bootstrap \
  node "$SCRIPT_DIR/verify-bootstrap-state.mjs" \
  --json-out "$RP_CB_BENCH/bootstrap-state-verify-latest.json" || \
  rp_cb_phase_fail J.final_contract "verify-bootstrap-state failed" "VERIFY_BOOTSTRAP_HTTP3_EDGE=1 make verify-bootstrap-state"

CLUSTER_DOCTOR_STRICT=1 make -C "$REPO_ROOT" cluster-doctor || \
  rp_cb_phase_fail J.final_contract "cluster-doctor failed" "CLUSTER_DOCTOR_STRICT=1 make cluster-doctor"

live_score="$(python3 -c "import json; print(json.load(open('$RP_CB_BENCH/cluster-doctor.json'))['live_health']['score'])" 2>/dev/null || echo 0)"
if [[ "$live_score" -lt "$RP_CLUSTER_DOCTOR_MIN_SCORE" ]]; then
  rp_cb_phase_fail J.final_contract "live health score $live_score < $RP_CLUSTER_DOCTOR_MIN_SCORE" "fix cluster then re-run make cold-bootstrap-post-hosts"
fi

make -C "$REPO_ROOT" bootstrap-drift-check || echo "⚠️  drift check reported issues (review bench_logs/drift-detection.json)"

chmod +x "$SCRIPT_DIR/rp-verify-slo-sla.sh" "$SCRIPT_DIR/rp-export-bootstrap-slo-prom.sh" 2>/dev/null || true
export RP_CB_SKIP_FINAL_SUMMARY=1
RP_SLO_SKIP_EDGE_PROBES=0 bash "$SCRIPT_DIR/rp-verify-slo-sla.sh" || \
  rp_cb_phase_fail J.final_contract "rp-verify-slo-sla failed" "bash scripts/rp-verify-slo-sla.sh"

VERIFY_BOOTSTRAP_FINAL_CONTRACT=1 HOUSING_NS="$HOUSING_NS" VERIFY_BOOTSTRAP_CONTEXT=post-bootstrap VERIFY_BOOTSTRAP_HTTP3_EDGE=1 \
  node "$SCRIPT_DIR/verify-bootstrap-state.mjs" \
  --json-out "$RP_CB_BENCH/bootstrap-state-verify-final.json" || \
  rp_cb_phase_fail J.final_contract "final contract verify failed" "review bench_logs/bootstrap-state-verify-final.json"

bash "$SCRIPT_DIR/export-bootstrap-phase-metrics.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/rp-export-bootstrap-slo-prom.sh" 2>/dev/null || true
node "$SCRIPT_DIR/render-bootstrap-dag-html.mjs" --html-out "$RP_CB_BENCH/bootstrap_dag.html" 2>/dev/null || true

rp_cb_phase_complete J.final_contract
rp_cb_ok "cold-bootstrap post-hosts contract complete (h2+h3 strict TLS + edge contract matrix)"

# shellcheck source=scripts/lib/rp-cold-bootstrap-final-summary.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh"
