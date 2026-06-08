#!/usr/bin/env bash
# Human-readable completion banner after cold-bootstrap post-hosts / SLO gates.
# Side-effect free when sourced; callers invoke rp_cb_final_summary_print explicitly.
set -euo pipefail

_rp_final_summary_wall_clock() {
  local bench="${RP_CB_BENCH:-${RP_CB_REPO_ROOT:-.}/bench_logs}"
  local timing_json="$bench/cold-bootstrap-last-timing.json"
  if [[ -f "$timing_json" ]]; then
    python3 -c "
import json, sys
d = json.load(open('$timing_json'))
print(d.get('duration_human') or '—')
" 2>/dev/null || echo "—"
  else
    echo "—"
  fi
}

_rp_final_summary() {
  local ns="${HOUSING_NS:-record-platform}"
  local host="${RP_PUBLIC_HOST:-record-platform.test}"
  local bench="${RP_CB_BENCH:-${RP_CB_REPO_ROOT:-.}/bench_logs}"
  local doctor_score="—"
  local bootstrap_overall="—"
  local caddy_ip="—"
  local ollama_ip="—"
  local ollama_cluster="—"
  local slo_ok="—"
  local wall_clock
  wall_clock="$(_rp_final_summary_wall_clock)"

  if [[ -f "$bench/cluster-doctor.json" ]]; then
    doctor_score="$(python3 -c "import json; d=json.load(open('$bench/cluster-doctor.json')); print(d.get('live_health',{}).get('score','?'))" 2>/dev/null || echo "?")"
  fi
  for vf in bootstrap-state-verify-final.json bootstrap-state-verify-latest.json; do
    if [[ -f "$bench/$vf" ]]; then
      bootstrap_overall="$(python3 -c "import json; print(json.load(open('$bench/$vf')).get('overall'))" 2>/dev/null || echo "?")"
      break
    fi
  done
  if [[ -f "$bench/rp_slo_sla_report.json" ]]; then
    slo_ok="$(python3 -c "import json; print(json.load(open('$bench/rp_slo_sla_report.json')).get('ok'))" 2>/dev/null || echo "?")"
  fi
  if [[ "${RP_CB_FINAL_SUMMARY_NO_KUBECTL:-0}" != "1" ]] && command -v kubectl >/dev/null 2>&1; then
    caddy_ip="$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    [[ -z "$caddy_ip" ]] && caddy_ip="$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
    ollama_ip="$(kubectl get svc -n "$ns" ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    [[ -z "$ollama_ip" ]] && ollama_ip="$(kubectl get svc -n "$ns" ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
    if kubectl get svc -n "$ns" ollama >/dev/null 2>&1; then
      ollama_cluster="http://ollama.${ns}.svc.cluster.local:11434"
    fi
  fi

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  Record Platform — cold-bootstrap complete"
  echo "════════════════════════════════════════════════════════════════"
  echo "  Namespace:        $ns"
  echo "  Public host:      $host  (must resolve in /etc/hosts)"
  echo "  Wall clock:       $wall_clock  (full cold-bootstrap suite)"
  echo "  Bootstrap verify: $bootstrap_overall"
  echo "  Cluster doctor:   ${doctor_score} / 100"
  echo "  SLO gates:        $slo_ok  (see bench_logs/rp_slo_sla_report.json)"
  local grpc_gate="—"
  local cert_gate="—"
  local edge_mtls="—"
  if [[ -f "$bench/security-contract/grpc-mtls-required-gate.json" ]]; then
    grpc_gate="$(python3 -c "import json; g=json.load(open('$bench/security-contract/grpc-mtls-required-gate.json')); print(f\"{g.get('checked','?')}/{g.get('expected',11)} required={g.get('all_required')} chain={g.get('cert_chain_ok')}\")" 2>/dev/null || echo "?")"
  fi
  if [[ -f "$bench/security-contract/service-cert-chain-contract.md" ]]; then
    cert_gate="$(grep -E '^\*\*RESULT:' "$bench/security-contract/service-cert-chain-contract.md" 2>/dev/null | tail -1 | sed 's/\*\*//g' || echo "see report")"
  fi
  if [[ -f "$bench/security-contract/mtls-real-smoke/report.md" ]]; then
    edge_mtls="$(grep -E 'overall|RESULT' "$bench/security-contract/mtls-real-smoke/report.md" 2>/dev/null | head -1 || echo "see report")"
  fi
  echo "  gRPC mTLS gate:   $grpc_gate"
  echo "  Cert chain:       $cert_gate"
  echo "  Edge mTLS smoke:  $edge_mtls"
  echo "────────────────────────────────────────────────────────────────"
  echo "  Edge (Caddy MetalLB)"
  echo "    MetalLB-only: TCP 443 + UDP 443 via LoadBalancer IP; nodePorts disabled"
  if [[ -n "$caddy_ip" && "$caddy_ip" != "—" ]]; then
    echo "    https://${host}/  →  ${caddy_ip}:443  (TCP + UDP / HTTP3)"
    echo "    /etc/hosts line:   ${caddy_ip}  ${host}"
  else
    echo "    LoadBalancer IP pending — kubectl get svc -n ingress-nginx caddy-h3"
  fi
  echo "────────────────────────────────────────────────────────────────"
  if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE:-1}" == "1" ]]; then
    echo "  Ollama"
    echo "    In-cluster:  ${ollama_cluster:-n/a}"
    if [[ -n "$ollama_ip" ]]; then
      echo "    MetalLB:     http://${ollama_ip}:11434  (service/ollama-lb)"
    else
      echo "    MetalLB:     pending — kubectl get svc -n $ns ollama-lb"
    fi
  else
    echo "  Ollama: skipped (RP_ENABLE_OLLAMA_EFFECTIVE=0)"
  fi
  echo "────────────────────────────────────────────────────────────────"
  echo "  Artifacts"
  echo "    $bench/bootstrap-state-verify-final.json"
  echo "    $bench/cluster-doctor.json"
  echo "    $bench/bootstrap_dag.html"
  echo "    $bench/cold-bootstrap-last-timing.json"
  echo "    ${RP_COLD_BOOTSTRAP_LOG:-/tmp/rp-cold-bootstrap.log}"
  echo "────────────────────────────────────────────────────────────────"
  echo "  Next — Phase 9 OBO DB/API (direct on main; Phase 10 auction blocked)"
  echo "    pnpm install --frozen-lockfile"
  echo "    bash scripts/rp-bootstrap-grpc-mtls-gate.sh"
  echo "    cd webapp && pnpm exec playwright test e2e/obo-offer-*.spec.ts \\"
  echo "      --workers=1 --retries=0 --timeout=180000 \\"
  echo "      E2E_API_BASE=https://${host} NODE_EXTRA_CA_CERTS=../certs/dev-root.pem"
  echo "    cd webapp && CONTRACT_SCREENSHOT_DATE=\$(date -u +%F) \\"
  echo "      E2E_API_BASE=https://${host} NODE_EXTRA_CA_CERTS=../certs/dev-root.pem \\"
  echo "      pnpm exec playwright test --workers=1 --retries=0 --timeout=180000"
  echo "    CONTRACT_ONLY=1 make rp-frontend-screenshot-strict-contract"
  echo "  Phase 10 auction: blocked until Phase 9 OBO is green end-to-end"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
}

rp_cb_final_summary_print() {
  _rp_final_summary
}

rp_cb_final_success_line() {
  echo "✅ COMPLETE — exit=0"
}

rp_cb_final_failure_footer() {
  local exit_code="${1:-1}"
  local failed_cmd="${2:-unknown}"
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  Record Platform — cold-bootstrap FAILED (exit=$exit_code)"
  echo "  Failed command: $failed_cmd"
  echo "  Review: bench_logs/cold-bootstrap.full.log"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
}
