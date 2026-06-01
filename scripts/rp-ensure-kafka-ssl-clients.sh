#!/usr/bin/env bash
# Ensure kafka-ssl-secret has client.crt/client.key (Node/KafkaJS mTLS). Repair partial secrets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
bad() { echo "❌ $*" >&2; }

_kafka_secret_has_client_mtls() {
  kubectl get secret kafka-ssl-secret -n "$NS" --request-timeout=15s >/dev/null 2>&1 || return 1
  kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.client\.crt}' --request-timeout=15s 2>/dev/null | grep -q .
}

if _kafka_secret_has_client_mtls; then
  ok "kafka-ssl-secret already has client.crt (ns=$NS)"
  exit 0
fi

say "kafka-ssl-secret incomplete in $NS — applying full material from certs/kafka-ssl"
if [[ ! -f "$REPO_ROOT/certs/kafka-ssl/client.crt" ]]; then
  bad "missing $REPO_ROOT/certs/kafka-ssl/client.crt — run: bash scripts/kafka-ssl-from-dev-root.sh"
  exit 1
fi

HOUSING_NS="$NS" bash "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh"

if ! _kafka_secret_has_client_mtls; then
  bad "kafka-ssl-secret still missing client.crt after apply"
  exit 1
fi
ok "kafka-ssl-secret repaired"

if [[ "${RP_KAFKA_SSL_RESTART_APPS:-1}" == "1" ]]; then
  say "Restarting Kafka mTLS consumer Deployments"
  for dep in media-service messaging-service notification-service trust-service analytics-service shopping-service listings-service auth-service api-gateway auction-monitor; do
    kubectl rollout restart "deployment/$dep" -n "$NS" --request-timeout=30s 2>/dev/null || true
  done
  ok "rollout restart requested for Kafka client services"
fi
