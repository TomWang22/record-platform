#!/usr/bin/env bash
# Ordered rollout restart for app Deployments (reduces readiness flapping after TLS / Kafka churn).
# Dependency-ish order: core data services → Kafka consumers → edge gateway. Caddy last (ingress).
#
# Usage:
#   Default: uses kubectl --request-timeout=25s
#   Before sourcing from reissue-ca-and-leaf-load-all-services.sh, define:
#     rp_kubectl() { kctl "$@"; }
#
# Env:
#   RP_ROLLOUT_NS — app namespace (default record-platform)
#   NS_ING — ingress namespace for Caddy (default ingress-nginx)
#   RP_ROLLOUT_STATUS_TIMEOUT — seconds for each kubectl rollout status (default 180)

if ! declare -F rp_kubectl >/dev/null 2>&1; then
  rp_kubectl() {
    kubectl --request-timeout=25s "$@"
  }
fi

rp_rollout_ordered_housing_apps() {
  local ns="${RP_ROLLOUT_NS:-record-platform}"
  local timeout="${RP_ROLLOUT_STATUS_TIMEOUT:-180}"
  # shellcheck source=scripts/lib/rp-runtime-deploy-services.sh
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-runtime-deploy-services.sh"
  local -a deps=("${RP_RUNTIME_APP_DEPLOYS[@]}")
  local d
  for d in "${deps[@]}"; do
    if rp_kubectl -n "$ns" get deploy "$d" >/dev/null 2>&1; then
      rp_kubectl -n "$ns" rollout restart "deploy/$d" >/dev/null 2>&1 \
        && echo "  ✅ rollout restart $d (sequential)" \
        || echo "  ⚠️  rollout restart $d failed"
      rp_kubectl -n "$ns" rollout status "deploy/$d" --timeout="${timeout}s" >/dev/null 2>&1 \
        && echo "  ✅ rollout status $d (≤${timeout}s)" \
        || echo "  ⚠️  rollout status $d not ready within ${timeout}s (continuing)"
    fi
  done
}

rp_rollout_caddy_last() {
  local ns_ing="${NS_ING:-ingress-nginx}"
  local timeout="${RP_ROLLOUT_STATUS_TIMEOUT:-180}"
  if rp_kubectl -n "$ns_ing" get deploy caddy-h3 >/dev/null 2>&1; then
    rp_kubectl -n "$ns_ing" rollout restart deploy/caddy-h3 >/dev/null 2>&1 \
      && echo "  ✅ rollout restart caddy-h3 (last)" \
      || echo "  ⚠️  rollout restart caddy-h3 failed"
    rp_kubectl -n "$ns_ing" rollout status deploy/caddy-h3 --timeout="${timeout}s" >/dev/null 2>&1 \
      && echo "  ✅ rollout status caddy-h3" \
      || echo "  ⚠️  rollout status caddy-h3 not ready within ${timeout}s"
  fi
}
