#!/usr/bin/env bash
# Ensure Kafka mTLS client cert env on RP producers/consumers that mount kafka-ssl-secret.
# Only patches containers that already mount kafka-ssl or kafka-ssl-certs
# (skips sidecars like transport-watchdog). RP manifests use volume name kafka-ssl.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-record-platform}"
CLIENT_CERT="/etc/kafka/secrets/client.crt"
CLIENT_KEY="/etc/kafka/secrets/client.key"
CA_CERT="/etc/kafka/secrets/ca-cert.pem"

DEPLOYS=(
  analytics-service
  auction-monitor
  python-ai-service
  notification-service
  listings-service
  messaging-service
  media-service
  records-service
  shopping-service
  trust-service
  auth-service
  api-gateway
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== rp-patch-kafka-mtls-client-env (ns=$NS) ==="

for d in "${DEPLOYS[@]}"; do
  if ! kubectl get deployment "$d" -n "$NS" &>/dev/null; then
    echo "ℹ️  skip $d (not deployed)"
    continue
  fi

  tmp="$(mktemp)"
  status="$(
    kubectl get deployment "$d" -n "$NS" -o json | python3 -c "
import json, sys
dep = json.load(sys.stdin)
dep.pop('status', None)
md = dep.setdefault('metadata', {})
for k in ('resourceVersion', 'uid', 'generation', 'creationTimestamp', 'managedFields'):
  md.pop(k, None)
spec = dep['spec']['template']['spec']
vol_names = {'kafka-ssl', 'kafka-ssl-certs'}
vols = spec.get('volumes') or []
for v in vols:
  if v.get('name') in vol_names:
    v['secret'] = {'secretName': 'kafka-ssl-secret', 'defaultMode': 420}
mount_names = set()
for c in spec.get('containers') or []:
  for m in c.get('volumeMounts') or []:
    if m.get('name') in vol_names:
      mount_names.add(c['name'])
want = {
  'KAFKA_CA_CERT': '$CA_CERT',
  'KAFKA_CLIENT_CERT': '$CLIENT_CERT',
  'KAFKA_CLIENT_KEY': '$CLIENT_KEY',
  'KAFKA_USE_SSL': 'true',
  'KAFKA_SSL_ENABLED': 'true',
}
kafka_keys = set(want) | {'KAFKA_SSL_CA_CERT'}
for c in spec.get('containers') or []:
  env = c.setdefault('env', [])
  by_name = {e.get('name'): e for e in env if e.get('name')}
  if c['name'] in mount_names:
    for k, v in want.items():
      if k in by_name and 'valueFrom' in by_name[k]:
        continue
      by_name[k] = {'name': k, 'value': v}
    if 'KAFKA_SSL_CA_CERT' not in by_name or 'value' in by_name.get('KAFKA_SSL_CA_CERT', {}):
      by_name['KAFKA_SSL_CA_CERT'] = {'name': 'KAFKA_SSL_CA_CERT', 'value': '$CA_CERT'}
    c['env'] = list(by_name.values())
  else:
    c['env'] = [e for e in env if e.get('name') not in kafka_keys]
out_path = sys.argv[1]
with open(out_path, 'w', encoding='utf-8') as f:
  json.dump(dep, f)
print('MOUNTED' if mount_names else 'NO_MOUNT')
" "$tmp"
  )"

  if [[ "$status" != "MOUNTED" ]]; then
    warn "skip $d (no kafka-ssl / kafka-ssl-certs volumeMount on app containers)"
    rm -f "$tmp"
    continue
  fi
  kubectl replace -f "$tmp" >/dev/null
  rm -f "$tmp"
  ok "patched $d KAFKA_CA/CLIENT env on kafka-mounted containers only"
done

say "Done. Rollout affected deployments if images already running."
