#!/usr/bin/env bash
# Resolve and print RP bootstrap trust mode (ML default; core-only explicit opt-out).
set -euo pipefail

_RP_TRUST_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/rp-ollama-gate-policy.sh
source "$_RP_TRUST_LIB_DIR/rp-ollama-gate-policy.sh"

rp_bootstrap_apply_trust_defaults() {
  rp_ollama_policy_resolve
}

rp_bootstrap_trust_mode_label() {
  rp_ollama_policy_resolve
  if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" == "1" ]]; then
    printf '%s' "full dev bootstrap (ML/Ollama trust enabled; RP_OLLAMA_REQUIRE_MODEL_EFFECTIVE=${RP_OLLAMA_REQUIRE_MODEL_EFFECTIVE})"
  else
    printf '%s' "core-only bootstrap: ML/Ollama trust disabled (set RP_ENABLE_OLLAMA=1 for full ML trust)"
  fi
}

rp_bootstrap_print_trust_banner() {
  rp_ollama_policy_resolve
  echo ""
  echo "━━━ RP bootstrap trust mode: $(rp_bootstrap_trust_mode_label) ━━━"
  rp_ollama_policy_print_effective
  echo ""
}
