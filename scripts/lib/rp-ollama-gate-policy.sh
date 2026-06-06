#!/usr/bin/env bash
# Single source of truth for Ollama ML gate policy (full ML default; core-only explicit opt-out).
set -euo pipefail

_RP_OLLAMA_POLICY_RESOLVED=0

# Treat unset or empty as default; only literal "0" disables (unless core-only).
_rp_ollama_bool_default_1() {
  local raw="${1-}"
  if [[ "$raw" == "0" ]]; then
    printf '0'
  else
    printf '1'
  fi
}

rp_ollama_policy_reset() {
  _RP_OLLAMA_POLICY_RESOLVED=0
  unset RP_CORE_ONLY_BOOTSTRAP_EFFECTIVE RP_ENABLE_OLLAMA_EFFECTIVE \
    OLLAMA_REQUIRED_EFFECTIVE RP_OLLAMA_REQUIRE_MODEL_EFFECTIVE || true
}

rp_ollama_policy_resolve() {
  if [[ "${_RP_OLLAMA_POLICY_RESOLVED:-0}" == "1" ]]; then
    return 0
  fi

  if [[ "${RP_CORE_ONLY_BOOTSTRAP:-0}" == "1" ]]; then
    export RP_CORE_ONLY_BOOTSTRAP_EFFECTIVE=1
    export RP_ENABLE_OLLAMA_EFFECTIVE=0
    export OLLAMA_REQUIRED_EFFECTIVE=0
    export RP_OLLAMA_REQUIRE_MODEL_EFFECTIVE="${RP_OLLAMA_REQUIRE_MODEL:-0}"
  else
    export RP_CORE_ONLY_BOOTSTRAP_EFFECTIVE=0
    export RP_ENABLE_OLLAMA_EFFECTIVE="$(_rp_ollama_bool_default_1 "${RP_ENABLE_OLLAMA-}")"
    export OLLAMA_REQUIRED_EFFECTIVE="$(_rp_ollama_bool_default_1 "${OLLAMA_REQUIRED-}")"
    export RP_OLLAMA_REQUIRE_MODEL_EFFECTIVE="${RP_OLLAMA_REQUIRE_MODEL:-0}"
  fi

  # Legacy exports — normalized (empty/unset → 1 unless explicit 0 or core-only).
  export RP_ENABLE_OLLAMA="$RP_ENABLE_OLLAMA_EFFECTIVE"
  export OLLAMA_REQUIRED="$OLLAMA_REQUIRED_EFFECTIVE"
  export RP_OLLAMA_REQUIRE_MODEL="$RP_OLLAMA_REQUIRE_MODEL_EFFECTIVE"

  _RP_OLLAMA_POLICY_RESOLVED=1
}

rp_ollama_env_validate() {
  rp_ollama_policy_resolve
  if [[ "${OLLAMA_REQUIRED_EFFECTIVE}" == "1" && "${RP_ENABLE_OLLAMA_EFFECTIVE}" != "1" ]]; then
    echo "❌ OLLAMA_REQUIRED=1 requires RP_ENABLE_OLLAMA=1 (effective: RP_ENABLE_OLLAMA_EFFECTIVE=${RP_ENABLE_OLLAMA_EFFECTIVE})" >&2
    return 1
  fi
  if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" == "0" && "${OLLAMA_REQUIRED_EFFECTIVE}" == "1" ]]; then
    echo "❌ RP_ENABLE_OLLAMA=0 incompatible with OLLAMA_REQUIRED=1" >&2
    return 1
  fi
  return 0
}

rp_ollama_gate_required() {
  rp_ollama_policy_resolve
  [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" == "1" ]]
}

rp_ollama_gate_skip() {
  rp_ollama_policy_resolve
  [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" != "1" ]]
}

rp_ollama_gate_skip_message() {
  rp_ollama_policy_resolve
  printf '%s' "⏭️  core-only bootstrap: ML/Ollama trust disabled (RP_ENABLE_OLLAMA_EFFECTIVE=0)"
}

rp_ollama_gate_required_message() {
  rp_ollama_policy_resolve
  printf '%s' "▶ Ollama ML gate required — full ML trust (RP_ENABLE_OLLAMA_EFFECTIVE=${RP_ENABLE_OLLAMA_EFFECTIVE} OLLAMA_REQUIRED_EFFECTIVE=${OLLAMA_REQUIRED_EFFECTIVE})"
}

rp_ollama_policy_print_effective() {
  rp_ollama_policy_resolve
  echo "  effective ML policy: RP_ENABLE_OLLAMA_EFFECTIVE=${RP_ENABLE_OLLAMA_EFFECTIVE} OLLAMA_REQUIRED_EFFECTIVE=${OLLAMA_REQUIRED_EFFECTIVE} RP_CORE_ONLY_BOOTSTRAP_EFFECTIVE=${RP_CORE_ONLY_BOOTSTRAP_EFFECTIVE}"
}
