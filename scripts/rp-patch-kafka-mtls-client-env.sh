#!/usr/bin/env bash
# RECOVERY / MIGRATION ONLY — not an acceptance verifier.
# Do NOT invoke from cold-bootstrap F.kafka_client_workloads.verify.
# Patches live Deployments to dedicated kafka-client-tls-<service> mounts.
# Acceptance must use committed manifests + read-only verify-kafka-client-workload-wiring.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-record-platform}"
CLIENT_CERT="/etc/kafka/client/tls.crt"
CLIENT_KEY="/etc/kafka/client/tls.key"
CA_CERT="/etc/kafka/client/ca-chain.pem"

# service -> deployment name (same for all current participants)
DEPLOYS=(
  analytics-service
  auction-monitor
  python-ai-service
  notification-service
  listings-service
  messaging-service
  media-service
  shopping-service
  trust-service
  auth-service
  ollama-gateway
  ollama-worker
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== rp-patch-kafka-mtls-client-env (dedicated kafka-client-tls; ns=$NS) ==="

for d in "${DEPLOYS[@]}"; do
  if ! kubectl get deployment "$d" -n "$NS" &>/dev/null; then
    echo "ℹ️  skip $d (not deployed)"
    continue
  fi
  secret="kafka-client-tls-${d}"
  if ! kubectl get secret "$secret" -n "$NS" &>/dev/null; then
    warn "skip $d (secret ${secret} missing — run apply-kafka-client-tls-secrets.sh)"
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
secret_name = sys.argv[2]
# Replace or insert kafka-client-tls volume
vols = [v for v in (spec.get('volumes') or []) if v.get('name') not in ('kafka-ssl', 'kafka-ssl-certs', 'kafka-client-tls')]
vols.append({
  'name': 'kafka-client-tls',
  'secret': {
    'secretName': secret_name,
    'defaultMode': 420,
    'items': [
      {'key': 'tls.crt', 'path': 'tls.crt'},
      {'key': 'tls.key', 'path': 'tls.key'},
      {'key': 'ca-chain.pem', 'path': 'ca-chain.pem'},
    ],
  },
})
spec['volumes'] = vols
want = {
  'KAFKA_CA_CERT': '$CA_CERT',
  'KAFKA_CLIENT_CERT': '$CLIENT_CERT',
  'KAFKA_CLIENT_KEY': '$CLIENT_KEY',
  'KAFKA_USE_SSL': 'true',
  'KAFKA_SSL_ENABLED': 'true',
}
kafka_keys = set(want) | {'KAFKA_SSL_CA_CERT'}
mount_names = set()
for c in spec.get('containers') or []:
  mounts = [m for m in (c.get('volumeMounts') or []) if m.get('name') not in ('kafka-ssl', 'kafka-ssl-certs')]
  # ensure kafka-client-tls mount
  mounts = [m for m in mounts if m.get('name') != 'kafka-client-tls']
  mounts.append({'name': 'kafka-client-tls', 'mountPath': '/etc/kafka/client', 'readOnly': True})
  c['volumeMounts'] = mounts
  mount_names.add(c['name'])
  env = c.setdefault('env', [])
  by_name = {e.get('name'): e for e in env if e.get('name')}
  for k, v in want.items():
    if k in by_name and 'valueFrom' in by_name[k]:
      continue
    by_name[k] = {'name': k, 'value': v}
  by_name['KAFKA_SSL_CA_CERT'] = {'name': 'KAFKA_SSL_CA_CERT', 'value': '$CA_CERT'}
  c['env'] = list(by_name.values())
out_path = sys.argv[1]
with open(out_path, 'w', encoding='utf-8') as f:
  json.dump(dep, f)
print('PATCHED' if mount_names else 'NO_CONTAINER')
" "$tmp" "$secret"
  )"

  if [[ "$status" != "PATCHED" ]]; then
    warn "skip $d ($status)"
    rm -f "$tmp"
    continue
  fi
  kubectl replace -f "$tmp" >/dev/null
  rm -f "$tmp"
  ok "patched $d → ${secret} @ /etc/kafka/client"
done

say "Done. Rollout affected deployments if images already running."
