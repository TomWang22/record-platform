#!/usr/bin/env bash
# Cold-bootstrap preflight bundle: durable gates before COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"

OUT="${RP_COLD_RUN_PREP_DIR:-$REPO_ROOT/bench_logs/cold-run-prep}"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

declare -a GATE_NAMES=()
declare -a GATE_STATUS=()
declare -a GATE_CMD=()
declare -a GATE_REPORTS=()

_fail_gate=0
_current_gate=""

_run_gate() {
  local name="$1"
  shift
  _current_gate="$name"
  local cmd="$*"
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "GATE: $name"
  echo "  $cmd"
  echo "══════════════════════════════════════════════════════════════"
  GATE_NAMES+=("$name")
  GATE_CMD+=("$cmd")
  if eval "$cmd"; then
    GATE_STATUS+=("PASS")
    GATE_REPORTS+=("")
    echo "✅ GATE PASS: $name"
  else
    GATE_STATUS+=("FAIL")
    GATE_REPORTS+=("")
    _fail_gate=1
    echo "❌ GATE FAIL: $name" >&2
    return 1
  fi
}

_run_gate_optional() {
  local name="$1"
  shift
  _current_gate="$name"
  local cmd="$*"
  echo ""
  echo "── optional: $name ──"
  GATE_NAMES+=("$name")
  GATE_CMD+=("$cmd")
  if eval "$cmd"; then
    GATE_STATUS+=("PASS")
    GATE_REPORTS+=("")
  else
    GATE_STATUS+=("WARN")
    GATE_REPORTS+=("")
    echo "⚠️  optional gate failed: $name" >&2
  fi
}

cd "$REPO_ROOT"

# Ordered gates (Part 7)
set +e
_run_gate "rp-audit-bootstrap-contract" "make rp-audit-bootstrap-contract"
_run_gate "audit-rp-cert-coverage" "bash scripts/audit-rp-cert-coverage.sh"
_run_gate "audit-rp-no-stale-pki" "bash scripts/audit-rp-no-stale-pki.sh"
_run_gate "audit-rp-k8s-service-tls-secrets" "bash scripts/audit-rp-k8s-service-tls-secrets.sh"
_run_gate "audit-rp-k8s-service-tls-mounts" "bash scripts/audit-rp-k8s-service-tls-mounts.sh"
_run_gate "audit-rp-grpc-cert-sans" "bash scripts/audit-rp-grpc-cert-sans.sh"
_run_gate "rca-rp-grpc-mtls" "bash scripts/rca-rp-grpc-mtls.sh --required"
_run_gate "audit-rp-webapp-service-contract" "bash scripts/audit-rp-webapp-service-contract.sh"
_run_gate "audit-rp-image-freshness" "bash scripts/audit-rp-image-freshness.sh"
_run_gate "audit-rp-metallb-quic-edge" "bash scripts/audit-rp-metallb-quic-edge.sh"
_run_gate "rollout-caddy" "CADDY_USE_LOADBALANCER=1 bash scripts/rollout-caddy.sh"
_run_gate "rca-rp-http3-timeout" "bash scripts/rca-rp-http3-timeout.sh"
_run_gate "smoke-rp-edge-http2-strict" "bash scripts/smoke-rp-edge-http2-strict.sh"
_run_gate "smoke-rp-edge-http3-strict" "bash scripts/smoke-rp-edge-http3-strict.sh"
_run_gate "smoke-rp-edge-contract" "bash scripts/smoke-rp-edge-contract.sh"
_run_gate "verify-app-runtime" "VERIFY_APP_RUNTIME_PHASE=cold VERIFY_APP_RUNTIME_SKIP_SLO_GATE=1 bash scripts/verify-app-runtime.sh"
_run_gate "audit-rp-ollama-stack" "bash scripts/audit-rp-ollama-stack.sh"
set -e

LB_IP="$(rp_http3_lb_ip 2>/dev/null || true)"
HOSTS_LINE=""
[[ -n "$LB_IP" ]] && HOSTS_LINE="${LB_IP} record-platform.test"

# Frontend route decision proof
FRONTEND_ROUTE="unknown"
FRONTEND_PROOF=""
if grep -q 'webapp.record-platform.svc.cluster.local:3001' "$REPO_ROOT/Caddyfile" \
  && grep -A5 '@web path' "$REPO_ROOT/Caddyfile" | grep -q 'webapp.record-platform.svc.cluster.local:3001'; then
  FRONTEND_ROUTE="Caddy → webapp:3001 (direct Next.js)"
  FRONTEND_PROOF="Caddyfile @web catch-all targets webapp:3001; nginx:8080 not on critical edge path"
elif grep -q 'nginx.record-platform.svc.cluster.local:8080' "$REPO_ROOT/Caddyfile"; then
  FRONTEND_ROUTE="Caddy → nginx:8080"
  FRONTEND_PROOF="Caddyfile still routes web to nginx:8080"
fi

POD_MATRIX="$OUT/pod-matrix.txt"
{
  echo "# pod matrix $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  kubectl get pods -A -o wide 2>/dev/null || true
} >"$POD_MATRIX"

SVC_MATRIX="$OUT/service-matrix.txt"
{
  echo "# service matrix $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  kubectl get svc -A -o wide 2>/dev/null || true
} >"$SVC_MATRIX"

{
  echo "# RP cold-run prep summary"
  echo ""
  echo "- **timestamp (UTC):** $TS"
  echo "- **overall:** $([[ "$_fail_gate" -eq 0 ]] && echo PASS || echo FAIL)"
  echo "- **LB IP:** \`${LB_IP:-empty}\`"
  echo "- **/etc/hosts line:** \`${HOSTS_LINE:-n/a}\`"
  echo "- **frontend route:** $FRONTEND_ROUTE"
  echo "- **frontend proof:** $FRONTEND_PROOF"
  echo ""
  echo "## Gate results"
  echo ""
  echo "| gate | status | command | report |"
  echo "|------|--------|---------|--------|"
  for i in "${!GATE_NAMES[@]}"; do
    rep=""
    case "${GATE_NAMES[$i]}" in
      smoke-rp-edge-http2-strict) rep="bench_logs/edge-h2-strict/report.md (+ failures.md)" ;;
      smoke-rp-edge-http3-strict) rep="bench_logs/edge-h3-strict/report.md (+ failures.md)" ;;
      smoke-rp-edge-contract) rep="bench_logs/edge-contract/report.md (+ failures.md)" ;;
      rca-rp-http3-timeout) rep="bench_logs/http3-timeout-rca/report.md" ;;
      rca-rp-grpc-mtls) rep="bench_logs/grpc-mtls-rca/report.md" ;;
      verify-app-runtime) rep="bench_logs/runtime-health/ (latest)" ;;
      rollout-caddy) rep="bench_logs/edge-h3-strict/report.md (post-rollout smoke)" ;;
    esac
    echo "| ${GATE_NAMES[$i]} | ${GATE_STATUS[$i]} | \`${GATE_CMD[$i]}\` | ${rep:-—} |"
  done
  echo ""
  echo "## Reports"
  echo "- edge HTTP/2: \`bench_logs/edge-h2-strict/report.md\`"
  echo "- edge HTTP/3: \`bench_logs/edge-h3-strict/report.md\`"
  echo "- edge contract: \`bench_logs/edge-contract/report.md\`"
  echo "- gRPC/mTLS matrix: \`bench_logs/grpc-mtls-rca/report.md\`"
  echo "- pod matrix: \`bench_logs/cold-run-prep/pod-matrix.txt\`"
  echo "- service matrix: \`bench_logs/cold-run-prep/service-matrix.txt\`"
  echo ""
  if [[ "$_fail_gate" -eq 0 ]]; then
    echo "## Next step"
    echo ""
    echo '✅ **rp-cold-run-prep passed.** Run cold-bootstrap:'
    echo '```bash'
    echo 'COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/hybrid-rp-och/materialized-rp-runtime make cold-bootstrap'
    echo '```'
  else
  failed_idx=-1
  for i in "${!GATE_STATUS[@]}"; do
    [[ "${GATE_STATUS[$i]}" == "FAIL" ]] && failed_idx=$i && break
  done
    echo "## Next step"
    echo ""
    echo "❌ **rp-cold-run-prep failed** at gate \`${GATE_NAMES[$failed_idx]:-unknown}\` — do not cold-bootstrap yet."
    echo ""
    echo "Failed command: \`${GATE_CMD[$failed_idx]:-}\`"
  fi
} >"$SUMMARY"

echo ""
echo "Wrote $SUMMARY"
cat "$SUMMARY"

if [[ "$_fail_gate" -ne 0 ]]; then
  exit 1
fi
