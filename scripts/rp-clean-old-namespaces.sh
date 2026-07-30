#!/usr/bin/env bash
# Ensure RP bootstrap namespaces exist. Destructive delete is opt-in only.
#
# Default (cold-bootstrap F.cluster_deploy): ensure record-platform / ingress-nginx /
# observability / envoy-test — never delete record-platform after B.crypto.
#
# Opt-in recovery:
#   RP_FORCE_NAMESPACE_DELETE=1 bash scripts/rp-clean-old-namespaces.sh
#
# Legacy: RP_CLEAN_OLD_NS=1 maps to RP_FORCE_NAMESPACE_DELETE=1 (deprecated).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HOUSING_NS="${HOUSING_NS:-record-platform}"

if [[ "${RP_CLEAN_OLD_NS:-0}" == "1" && "${RP_FORCE_NAMESPACE_DELETE:-0}" != "1" ]]; then
  echo "⚠️  RP_CLEAN_OLD_NS=1 is deprecated — treating as RP_FORCE_NAMESPACE_DELETE=1"
  export RP_FORCE_NAMESPACE_DELETE=1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl required" >&2
  exit 1
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

_rp_ensure_ns() {
  local ns="$1"
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
  kubectl get namespace "$ns" --request-timeout=15s >/dev/null 2>&1
}

_rp_diagnose_ns_stuck() {
  local ns="$1"
  echo "--- namespace $ns (describe) ---"
  kubectl get namespace "$ns" -o json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("phase:", d.get("status", {}).get("phase"))
print("finalizers:", d.get("spec", {}).get("finalizers"))
' 2>/dev/null || kubectl get namespace "$ns" -o yaml 2>/dev/null || true
  echo "--- namespaced resources in $ns ---"
  kubectl api-resources --verbs=list --namespaced -o name 2>/dev/null | while read -r r; do
    kubectl get "$r" -n "$ns" --ignore-not-found --request-timeout=10s 2>/dev/null | tail -n +2 | head -5
  done | head -40 || true
  echo "--- recent events (namespace-scoped) ---"
  kubectl get events -n "$ns" --sort-by=.lastTimestamp 2>/dev/null | tail -15 || true
}

_rp_wait_ns_gone() {
  local ns="$1" max="${2:-90}" i
  for ((i = 0; i < max; i++)); do
    if ! kubectl get namespace "$ns" --request-timeout=10s >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

_rp_force_delete_ns() {
  local ns="$1"
  local delete_timeout="${RP_NAMESPACE_DELETE_TIMEOUT:-60s}"

  say "⚠️  destructive namespace delete enabled ($ns)"
  if ! kubectl delete namespace "$ns" --ignore-not-found=true --wait=true --timeout="$delete_timeout" 2>/dev/null; then
    echo "❌ kubectl delete namespace $ns did not complete within $delete_timeout" >&2
    _rp_diagnose_ns_stuck "$ns"
    if ! _rp_wait_ns_gone "$ns" 90; then
      echo "❌ namespace $ns still terminating after 90s" >&2
      _rp_diagnose_ns_stuck "$ns"
      return 1
    fi
  fi
  if ! _rp_wait_ns_gone "$ns" 90; then
    echo "❌ namespace $ns still present after delete wait" >&2
    _rp_diagnose_ns_stuck "$ns"
    return 1
  fi
  _rp_ensure_ns "$ns"
  echo "✅ namespace $ns recreated"
  return 0
}

say "Pre-bootstrap namespace check"
kubectl get ns 2>/dev/null | grep -E 'off-campus|record-platform|ingress-nginx|observability|envoy-test' || true

if [[ "${RP_FORCE_NAMESPACE_DELETE:-0}" == "1" ]]; then
  if [[ "${RP_COLD_BOOTSTRAP_RESET_DONE:-0}" == "1" ]]; then
    echo "ℹ️  RP_COLD_BOOTSTRAP_RESET_DONE=1 — destructive delete still allowed (RP_FORCE_NAMESPACE_DELETE=1)"
  fi
  _rp_force_delete_ns "$HOUSING_NS" || exit 1
  # RP namespace only when explicitly forcing cleanup (recovery / mixed clusters)
  kubectl delete namespace record-platform --ignore-not-found=true --wait=true --timeout=60s 2>/dev/null \
    || kubectl delete namespace record-platform --ignore-not-found=true 2>/dev/null || true
  if [[ -x "$SCRIPT_DIR/strict-tls-bootstrap.sh" ]]; then
    echo "▶ re-apply strict-tls-bootstrap after namespace recreate"
    bash "$SCRIPT_DIR/strict-tls-bootstrap.sh" || {
      echo "❌ strict-tls-bootstrap failed after namespace delete" >&2
      exit 1
    }
  fi
  echo "✅ destructive namespace cleanup complete"
  exit 0
fi

if [[ "${RP_COLD_BOOTSTRAP_RESET_DONE:-0}" == "1" ]]; then
  echo "✅ namespace cleanup skipped — P0 hard reset already produced clean cluster"
else
  echo "✅ namespace delete skipped (default; use RP_FORCE_NAMESPACE_DELETE=1 for recovery)"
fi

printf '  ▶ namespace ensure\n'
for ns in ingress-nginx observability envoy-test "$HOUSING_NS"; do
  if kubectl get namespace "$ns" --request-timeout=15s >/dev/null 2>&1; then
    echo "  ✅ ${ns} exists"
  else
    _rp_ensure_ns "$ns"
    echo "  ✅ ${ns} created"
  fi
done
echo "✅ record-platform namespace ensured"
