#!/usr/bin/env bash
# Roll out Envoy (envoy-test gRPC edge + optional ingress-nginx envoy) and RP app workloads
# after Postgres recycle / pool tuning so pods pick up new Prisma pool sizes and refreshed config.
#
# Usage (repo root):
#   ./scripts/rollout-restart-rp-after-pool-tuning.sh
#
# Env:
#   KUBECTL  — default kubectl
#   RP_NS   — default record-platform
#   INGRESS_NS — default ingress-nginx
#   SKIP_ENVOY — 1: skip all Envoy deployment restarts
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
RP_NS="${RP_NS:-record-platform}"
INGRESS_NS="${INGRESS_NS:-ingress-nginx}"
SKIP_ENVOY="${SKIP_ENVOY:-0}"

RP_DEPLOYMENTS=(
  api-gateway
  auth-service
  listings-service
  reservation-mesh
  messaging-service
  trust-service
  analytics-service
  media-service
  notification-service
  webapp
)

if [[ "$SKIP_ENVOY" != "1" ]]; then
  if "$KUBECTL" get deploy envoy-test -n envoy-test &>/dev/null; then
    echo "Rollout restart: deployment/envoy-test -n envoy-test"
    "$KUBECTL" rollout restart deployment/envoy-test -n envoy-test
    "$KUBECTL" rollout status deployment/envoy-test -n envoy-test --timeout=300s
  fi
  if "$KUBECTL" get deploy envoy -n "$INGRESS_NS" &>/dev/null; then
    echo "Rollout restart: deployment/envoy -n $INGRESS_NS"
    "$KUBECTL" rollout restart deployment/envoy -n "$INGRESS_NS"
    "$KUBECTL" rollout status deployment/envoy -n "$INGRESS_NS" --timeout=300s
  fi
fi

echo "Rollout restart: ${RP_DEPLOYMENTS[*]} -n $RP_NS"
"$KUBECTL" rollout restart deployment "${RP_DEPLOYMENTS[@]}" -n "$RP_NS"
for d in "${RP_DEPLOYMENTS[@]}"; do
  "$KUBECTL" rollout status "deployment/$d" -n "$RP_NS" --timeout=300s
done

echo "Done."
