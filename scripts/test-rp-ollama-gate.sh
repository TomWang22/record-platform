#!/usr/bin/env bash
# Regression tests for Ollama ML gate policy (defaults: full ML trust).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "  ✅ $*"; }

# Defaults (full ML trust) — unset must normalize to effective=1
unset RP_ENABLE_OLLAMA OLLAMA_REQUIRED RP_CORE_ONLY_BOOTSTRAP RP_OLLAMA_REQUIRE_MODEL
rp_ollama_policy_reset
rp_ollama_policy_resolve
[[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" == "1" ]] || fail "default RP_ENABLE_OLLAMA_EFFECTIVE"
[[ "${OLLAMA_REQUIRED_EFFECTIVE}" == "1" ]] || fail "default OLLAMA_REQUIRED_EFFECTIVE"
rp_ollama_gate_required || fail "default: gate must be required"
rp_ollama_gate_skip && fail "default: must not skip"
rp_ollama_env_validate || fail "default: validate must pass"
ok "defaults: RP_ENABLE_OLLAMA_EFFECTIVE=1 OLLAMA_REQUIRED_EFFECTIVE=1"

# Unset RP_ENABLE_OLLAMA with OLLAMA_REQUIRED=1 must not fail validate
unset RP_ENABLE_OLLAMA
export OLLAMA_REQUIRED=1
unset RP_CORE_ONLY_BOOTSTRAP
rp_ollama_policy_reset
rp_ollama_env_validate 2>/dev/null || fail "unset RP_ENABLE_OLLAMA + OLLAMA_REQUIRED=1 must pass"
rp_ollama_gate_required || fail "unset enable + required: gate required"
ok "unset RP_ENABLE_OLLAMA + OLLAMA_REQUIRED=1 → effective enable=1"

# Empty RP_ENABLE_OLLAMA must normalize to 1
export RP_ENABLE_OLLAMA=""
export OLLAMA_REQUIRED=1
rp_ollama_policy_reset
rp_ollama_env_validate 2>/dev/null || fail "empty RP_ENABLE_OLLAMA must normalize to 1"
ok "empty RP_ENABLE_OLLAMA → RP_ENABLE_OLLAMA_EFFECTIVE=1"

# Core-only explicit opt-out
unset RP_ENABLE_OLLAMA OLLAMA_REQUIRED
export RP_CORE_ONLY_BOOTSTRAP=1
rp_ollama_policy_reset
rp_ollama_gate_skip || fail "core-only: must skip"
rp_ollama_gate_required && fail "core-only: must not require"
[[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" == "0" ]] || fail "core-only effective enable"
ok "RP_CORE_ONLY_BOOTSTRAP=1 → core-only (ML disabled)"

# RP_ENABLE_OLLAMA=0 explicit
unset RP_CORE_ONLY_BOOTSTRAP
export RP_ENABLE_OLLAMA=0
export OLLAMA_REQUIRED=0
rp_ollama_policy_reset
rp_ollama_gate_skip || fail "RP_ENABLE_OLLAMA=0: expected skip"
ok "RP_ENABLE_OLLAMA=0 → skip gate"

# Invalid: OLLAMA_REQUIRED=1 with RP_ENABLE_OLLAMA=0
export OLLAMA_REQUIRED=1
export RP_ENABLE_OLLAMA=0
rp_ollama_policy_reset
if rp_ollama_env_validate 2>/dev/null; then
  fail "OLLAMA_REQUIRED=1 + RP_ENABLE_OLLAMA=0 must fail validate"
fi
ok "rejected invalid policy: OLLAMA_REQUIRED=1 with RP_ENABLE_OLLAMA=0"

# Valid pair
export RP_ENABLE_OLLAMA=1
export OLLAMA_REQUIRED=1
rp_ollama_policy_reset
rp_ollama_env_validate 2>/dev/null || fail "valid pair should pass"
rp_ollama_gate_required || fail "OLLAMA_REQUIRED=1 + RP_ENABLE_OLLAMA=1 → required"
ok "RP_ENABLE_OLLAMA=1 OLLAMA_REQUIRED=1 → full ML trust"

echo ""
echo "✅ test-rp-ollama-gate.sh passed"
