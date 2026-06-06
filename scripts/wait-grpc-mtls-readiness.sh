#!/usr/bin/env bash
# Pre–app-runtime wait: Deployments available, Services have endpoints, TLS secrets present.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-runtime-health-contract.sh
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-${NAMESPACE:-record-platform}}"
TIMEOUT="${WAIT_GRPC_MTLS_TIMEOUT_SEC:-600}"
PREFIX="$(rp_cert_contract_per_service_secret_prefix)"

fail=0
echo "wait-grpc-mtls-readiness: ns=$NS timeout=${TIMEOUT}s"

while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  json="$(rp_runtime_health_service_json "$svc")"
  dep="$(jq -r '.k8sName // .deployment // empty' <<<"$json")"
  grpc_port="$(jq -r '.grpcPort // empty' <<<"$json")"
  [[ -n "$dep" ]] || continue
  [[ -n "$grpc_port" && "$grpc_port" != "null" ]] || continue

  if ! kubectl get deploy "$dep" -n "$NS" >/dev/null 2>&1; then
    echo "  ⚠️  $svc: deployment $dep missing — skip"
    continue
  fi

  echo "  ▶ $svc: rollout deploy/$dep"
  if ! kubectl -n "$NS" rollout status "deploy/$dep" --timeout="${TIMEOUT}s" >/dev/null 2>&1; then
    echo "  ❌ $svc: rollout not ready within ${TIMEOUT}s" >&2
    fail=1
    continue
  fi

  secret="${PREFIX}${svc}"
  for key in tls.crt tls.key ca.crt; do
    case "$key" in
      tls.crt) jp='{.data.tls\.crt}' ;;
      tls.key) jp='{.data.tls\.key}' ;;
      ca.crt) jp='{.data.ca\.crt}' ;;
    esac
    if ! kubectl get secret "$secret" -n "$NS" -o "jsonpath=$jp" 2>/dev/null | grep -q .; then
      echo "  ❌ $svc: secret $secret missing data.$key" >&2
      fail=1
    fi
  done

  eps="$(kubectl get endpoints "$dep" -n "$NS" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)"
  if [[ -z "$eps" ]]; then
    echo "  ❌ $svc: Service $dep has no ready endpoints" >&2
    fail=1
  else
    echo "  ✅ $svc: endpoints ok (grpc :$grpc_port)"
  fi
done < <(rp_cert_contract_mtls_services)

[[ "$fail" -eq 0 ]] || exit 1
echo "✅ wait-grpc-mtls-readiness: all gRPC mTLS services ready"
exit 0
