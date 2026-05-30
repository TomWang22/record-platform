#!/usr/bin/env bash
# Human-readable completion banner after cold-bootstrap post-hosts / SLO gates.
# Sources rp-cold-bootstrap-lib.sh (RP_CB_BENCH, HOUSING_NS, RP_PUBLIC_HOST).
set -euo pipefail

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
  if command -v kubectl >/dev/null 2>&1; then
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
  echo "  Bootstrap verify: $bootstrap_overall"
  echo "  Cluster doctor:   ${doctor_score} / 100"
  echo "  SLO gates:        $slo_ok  (see bench_logs/rp_slo_sla_report.json)"
  echo "────────────────────────────────────────────────────────────────"
  echo "  Edge (Caddy MetalLB)"
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
  echo "    ${RP_COLD_BOOTSTRAP_LOG:-/tmp/rp-cold-bootstrap.log}"
  echo "────────────────────────────────────────────────────────────────"
  echo "  Next (Phase 8.8+ — not Phase 9 OBO yet)"
  echo "    cd webapp && CONTRACT_SCREENSHOT_DATE=\$(date -u +%F) \\"
  echo "      E2E_API_BASE=https://${host} NODE_EXTRA_CA_CERTS=../certs/dev-root.pem \\"
  echo "      pnpm exec playwright test --workers=1 --retries=0"
  echo "    make rp-frontend-screenshot-strict-contract"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
}

_rp_final_summary
