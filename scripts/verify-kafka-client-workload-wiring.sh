#!/usr/bin/env bash
# Fail-closed static (+ optional live) audit that participant Deployments mount
# kafka-client-tls-<service> at /etc/kafka/client and do not mount shared client.crt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
CHECK_LIVE="${RP_KAFKA_CLIENT_WIRE_LIVE:-1}"

SERVICES=(
  analytics-service
  auction-monitor
  auth-service
  listings-service
  media-service
  messaging-service
  notification-service
  python-ai-service
  shopping-service
  trust-service
  ollama-gateway
  ollama-worker
)

deploy_path() {
  case "$1" in
    ollama-gateway) printf '%s' "infra/k8s/base/ollama/gateway-deploy.yaml" ;;
    ollama-worker) printf '%s' "infra/k8s/base/ollama/worker-deploy.yaml" ;;
    *) printf '%s' "infra/k8s/base/${1}/deploy.yaml" ;;
  esac
}

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

static_ok=0
for svc in "${SERVICES[@]}"; do
  f="${REPO_ROOT}/$(deploy_path "$svc")"
  [[ -f "$f" ]] || fail "missing deploy ${f}"
  grep -q "secretName: kafka-client-tls-${svc}" "$f" || fail "${svc}: missing dedicated secretName"
  grep -q 'mountPath: /etc/kafka/client' "$f" || fail "${svc}: missing /etc/kafka/client mount"
  grep -q '/etc/kafka/client/tls.crt' "$f" || fail "${svc}: KAFKA_CLIENT_CERT path"
  grep -q '/etc/kafka/client/tls.key' "$f" || fail "${svc}: KAFKA_CLIENT_KEY path"
  grep -q '/etc/kafka/client/ca-chain.pem' "$f" || fail "${svc}: KAFKA_CA_CERT path"
  if grep -q 'secretName: kafka-ssl-secret' "$f"; then
    fail "${svc}: still references kafka-ssl-secret"
  fi
  if grep -q '/etc/kafka/secrets/client.crt' "$f"; then
    fail "${svc}: still references shared client.crt path"
  fi
  static_ok=$((static_ok + 1))
  ok "static ${svc}"
done
[[ "$static_ok" -eq 12 ]] || fail "static mounts ${static_ok}/12"

if [[ "$CHECK_LIVE" == "1" ]] && kubectl get ns "$NS" >/dev/null 2>&1; then
  live_ok=0
  for svc in "${SERVICES[@]}"; do
    if ! kubectl -n "$NS" get deploy "$svc" >/dev/null 2>&1; then
      echo "ℹ️  live skip ${svc} (not deployed)"
      continue
    fi
    json="$(kubectl -n "$NS" get deploy "$svc" -o json)"
    echo "$json" | grep -q "kafka-client-tls-${svc}" || fail "live ${svc}: secret not in deployment"
    echo "$json" | grep -q '/etc/kafka/client' || fail "live ${svc}: mount path missing"
    if echo "$json" | grep -q '"secretName": "kafka-ssl-secret"'; then
      fail "live ${svc}: still mounts kafka-ssl-secret"
    fi
    live_ok=$((live_ok + 1))
    ok "live ${svc}"
  done
  echo "live_checked=${live_ok}"
fi

ok "verify-kafka-client-workload-wiring: static 12/12"
