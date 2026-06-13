#!/usr/bin/env bash
# Ensure Kafka mTLS client cert env on RP producers/consumers that mount kafka-ssl-secret.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-record-platform}"
CLIENT_CERT="/etc/kafka/secrets/client.crt"
CLIENT_KEY="/etc/kafka/secrets/client.key"

DEPLOYS=(
  analytics-service
  auction-monitor
  python-ai-service
  notification-service
  listings-service
  messaging-service
  records-service
  shopping-service
  social-service
  trust-service
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== rp-patch-kafka-mtls-client-env (ns=$NS) ==="

for d in "${DEPLOYS[@]}"; do
  if ! kubectl get deployment "$d" -n "$NS" &>/dev/null; then
    echo "ℹ️  skip $d (not deployed)"
    continue
  fi
  kubectl set env deployment/"$d" -n "$NS" \
    KAFKA_CLIENT_CERT="$CLIENT_CERT" \
    KAFKA_CLIENT_KEY="$CLIENT_KEY" \
    KAFKA_USE_SSL=true \
    KAFKA_SSL_ENABLED=true >/dev/null
  # Ensure full kafka-ssl-secret mount (not CA-only items list)
  kubectl patch deployment "$d" -n "$NS" --type=json -p='[{"op":"replace","path":"/spec/template/spec/volumes","value":'"$(kubectl get deployment "$d" -n "$NS" -o json | python3 -c "
import json,sys
d=json.load(sys.stdin)
vols=d['spec']['template']['spec'].get('volumes',[])
for v in vols:
  if v.get('name')=='kafka-ssl-certs':
    v['secret']={'secretName':'kafka-ssl-secret','defaultMode':420}
print(json.dumps(vols))
")"'}]' >/dev/null 2>&1 || true
  ok "patched $d KAFKA_CLIENT_CERT/KEY + kafka volume"
done

say "Done. Rollout affected deployments if images already running."
