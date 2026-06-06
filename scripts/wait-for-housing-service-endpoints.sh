#!/usr/bin/env bash
# Wait until RP app Services have ready Endpoints (and optional Ollama ML gate).
# Ollama is optional in dev unless OLLAMA_REQUIRED=1 or RP_ENABLE_OLLAMA=1.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-runtime-deploy-services.sh
source "$SCRIPT_DIR/lib/rp-runtime-deploy-services.sh"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"

NS="${HOUSING_NS:-record-platform}"
TIMEOUT="${WAIT_ENDPOINTS_TIMEOUT:-240}"
OLLAMA_TIMEOUT="${WAIT_OLLAMA_TIMEOUT:-600}"

SERVICES=(webapp "${RP_RUNTIME_APP_DEPLOYS[@]}")

rp_ollama_policy_resolve

echo ""
echo "wait-for-housing-service-endpoints (Record Platform ns=$NS timeout_per_svc=${TIMEOUT}s ollama_timeout=${OLLAMA_TIMEOUT}s)"
rp_ollama_policy_print_effective

_ollama_replicas() {
  local r
  r="$(kubectl get deployment ollama -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  if [[ -z "$r" ]]; then
    echo "missing"
    return 1
  fi
  echo "$r"
}

_run_ollama_gate() {
  echo "  $(rp_ollama_gate_required_message)"
  echo "  ▶ Ollama ML gate: rollout status (timeout ${OLLAMA_TIMEOUT}s)…"
  if ! kubectl rollout status deployment/ollama -n "$NS" --timeout="${OLLAMA_TIMEOUT}s" 2>/dev/null; then
    echo "❌ Ollama rollout not complete within ${OLLAMA_TIMEOUT}s" >&2
    return 1
  fi
  echo "  ▶ Ollama ML gate: pod condition Ready (timeout ${OLLAMA_TIMEOUT}s)…"
  local deadline=$(( $(date +%s) + OLLAMA_TIMEOUT ))
  while [[ $(date +%s) -lt $deadline ]]; do
    local ready
    ready="$(kubectl get pods -n "$NS" -l 'app=ollama' -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null | grep -c '^True$' || true)"
    if [[ "${ready:-0}" -ge 1 ]]; then
      echo "  ✅ Ollama Ready"
      return 0
    fi
    sleep 5
  done
  echo "❌ Ollama pods not Ready within ${OLLAMA_TIMEOUT}s" >&2
  return 1
}

_handle_ollama_gate() {
  rp_ollama_env_validate || return 1
  if rp_ollama_gate_skip; then
    echo "  $(rp_ollama_gate_skip_message)"
    local reps
    reps="$(_ollama_replicas || true)"
    if [[ "$reps" == "missing" ]]; then
      echo "  ℹ️  deployment/ollama not found — continuing"
      return 0
    fi
    if [[ "$reps" == "0" ]]; then
      echo "  ℹ️  deployment/ollama replicas=0 — continuing"
      return 0
    fi
    local ready
    ready="$(kubectl get pods -n "$NS" -l 'app=ollama' -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null | grep -c '^True$' || true)"
    if [[ "${ready:-0}" -lt 1 ]]; then
      echo "  ⚠️  Ollama service present but no Ready pods (optional gate — continuing)" >&2
    fi
    return 0
  fi

  local reps
  reps="$(_ollama_replicas || true)"
  if [[ "$reps" == "missing" ]]; then
    if rp_ollama_gate_required; then
      echo "❌ OLLAMA_REQUIRED_EFFECTIVE=1 but deployment/ollama missing in ns=$NS (run ensure-rp-ollama-enabled.sh)" >&2
      return 1
    fi
    echo "  ℹ️  deployment/ollama missing — optional gate skipped"
    return 0
  fi
  if [[ "$reps" == "0" ]]; then
    if rp_ollama_gate_required; then
      echo "❌ OLLAMA_REQUIRED_EFFECTIVE=1 but deployment/ollama replicas=0 (run ensure-rp-ollama-enabled.sh)" >&2
      return 1
    fi
    echo "  ⏭️  deployment/ollama replicas=0 — skipping Ready wait (OLLAMA_REQUIRED!=1)"
    return 0
  fi

  _run_ollama_gate
}

_handle_ollama_gate || exit 1

wait_one() {
  local svc="$1"
  local t="$TIMEOUT"
  local deadline=$(( $(date +%s) + t ))
  while [[ $(date +%s) -lt $deadline ]]; do
    local ready
    ready="$(kubectl get endpoints "$svc" -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
    if [[ "${ready:-0}" -ge 1 ]]; then
      echo "  ✅ $svc endpoints ready"
      return 0
    fi
    sleep 3
  done
  echo "❌ $svc has no ready endpoints within ${t}s" >&2
  return 1
}

for svc in "${SERVICES[@]}"; do
  wait_one "$svc" || exit 1
done

echo "✅ Record Platform service endpoints ready (ns=$NS)"
