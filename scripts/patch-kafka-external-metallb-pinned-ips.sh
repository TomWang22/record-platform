#!/usr/bin/env bash
# Pin stable MetalLB IPs on kafka-N-external Services (annotation metallb.universe.tf/loadBalancerIPs).
# Prevents EXTERNAL advertised.listeners drift when the pool reallocates.
#
# Convention (cold-bootstrap / Colima):
#   Kafka brokers own the first N addresses in METALLB_POOL (offset 0 by default).
#   Example METALLB_POOL=192.168.64.240-192.168.64.250, offset 0 →
#     kafka-0=.240, kafka-1=.241, kafka-2=.242
#   Later LBs (ollama-lb, caddy-h3) auto-assign from the remainder (.243+).
#   Do NOT use offset 1 with this pool — kafka-2 lands on .243 and collides with ollama-lb.
#
# Usage:
#   METALLB_POOL=192.168.64.240-192.168.64.250 HOUSING_NS=record-platform ./scripts/patch-kafka-external-metallb-pinned-ips.sh
# Explicit list (must match replica count):
#   KAFKA_METALLB_PIN_IPS=192.168.64.240,192.168.64.241,192.168.64.242 ./scripts/patch-kafka-external-metallb-pinned-ips.sh
#
# Skip: KAFKA_SKIP_METALLB_EXTERNAL_PIN=1
#
# Drift guard: IP math must stay in lockstep with scripts/lib/kafka-metallb-pin-formula.sh.
# After changing pool/offset/replicas or this script, run: ./scripts/verify-kafka-metallb-pin-formula.sh
# CI: .github/workflows/kafka-dns-validate.yml + kafka-cluster-verify.yml (table tests).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/kafka-metallb-pin-formula.sh"

NS="${HOUSING_NS:-record-platform}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
ANNOT_KEY="metallb.universe.tf/loadBalancerIPs"

if [[ "${KAFKA_SKIP_METALLB_EXTERNAL_PIN:-0}" == "1" ]]; then
  echo "ℹ️  patch-kafka-external-metallb-pinned-ips: skipped (KAFKA_SKIP_METALLB_EXTERNAL_PIN=1)"
  exit 0
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "❌ kubectl not on PATH" >&2
  exit 1
fi

if ! kubectl get svc kafka-0-external -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  echo "ℹ️  patch-kafka-external-metallb-pinned-ips: no kafka-0-external in ns=$NS — skipping"
  exit 0
fi

POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
och_metallb_pool_first_ip "$POOL" >/dev/null || {
  echo "❌ Invalid METALLB_POOL: $POOL" >&2
  exit 1
}

# Default 0: brokers take pool[.240..]; ollama/caddy take later free IPs. Offset 1 collides with ollama-lb on Colima.
OFFSET="${KAFKA_METALLB_FIRST_OFFSET:-0}"
declare -a IPS=()
if [[ -n "${KAFKA_METALLB_PIN_IPS:-}" ]]; then
  IFS=',' read -r -a _raw <<<"${KAFKA_METALLB_PIN_IPS// /}"
  for x in "${_raw[@]}"; do
    x="${x//[[:space:]]/}"
    [[ -n "$x" ]] && IPS+=("$x")
  done
  if [[ "${#IPS[@]}" -lt "$REP" ]]; then
    echo "❌ KAFKA_METALLB_PIN_IPS has ${#IPS[@]} entries; need $REP (comma-separated)" >&2
    exit 1
  fi
else
  for ((i = 0; i < REP; i++)); do
    IPS[i]="$(rp_kafka_metallb_expected_ip_for_broker "$POOL" "$OFFSET" "$i")" || exit 1
  done
fi

# Collision guard: refuse pins already held (status or pin annotation) by non-kafka LoadBalancers.
_rp_lb_holders_for_ip() {
  local want_ip="$1"
  local json
  json="$(kubectl get svc -A -o json --request-timeout=30s 2>/dev/null)" || return 0
  printf '%s' "$json" | WANT_IP="$want_ip" python3 -c "
import json, os, sys
want = os.environ['WANT_IP']
for item in json.load(sys.stdin).get('items') or []:
    md = item.get('metadata') or {}
    spec = item.get('spec') or {}
    if spec.get('type') != 'LoadBalancer':
        continue
    ns = md.get('namespace') or ''
    name = md.get('name') or ''
    if name.startswith('kafka-') and name.endswith('-external'):
        continue
    anns = md.get('annotations') or {}
    pinned = anns.get('metallb.universe.tf/loadBalancerIPs') or anns.get('metallb.io/loadBalancerIPs') or ''
    ingress = ((item.get('status') or {}).get('loadBalancer') or {}).get('ingress') or []
    status_ips = [x.get('ip') for x in ingress if x.get('ip')]
    tags = []
    if want in [p.strip() for p in pinned.split(',') if p.strip()]:
        tags.append('pin')
    if want in status_ips:
        tags.append('status')
    if tags:
        print('%s/%s[%s]' % (ns, name, '|'.join(tags)))
"
}

echo "=== patch-kafka-external-metallb-pinned-ips (ns=$NS replicas=$REP offset=$OFFSET) ==="
COLLIDE=0
for ((i = 0; i < REP; i++)); do
  ip="${IPS[i]}"
  holders="$(_rp_lb_holders_for_ip "$ip" || true)"
  if [[ -n "${holders//[[:space:]]/}" ]]; then
    echo "❌ Collision: planned kafka-${i}-external pin $ip already used by:" >&2
    echo "$holders" | sed 's/^/    /' >&2
    COLLIDE=1
  fi
done
if [[ "$COLLIDE" -ne 0 ]]; then
  echo "❌ RCA: MetalLB cannot share one IP across unrelated Services (AllocationFailed / pending EXTERNAL-IP)." >&2
  echo "   Fix: use KAFKA_METALLB_FIRST_OFFSET=0 (kafka=.240-.242) so ollama-lb/caddy keep .243+," >&2
  echo "   or set KAFKA_METALLB_PIN_IPS to free addresses, or move the colliding Service." >&2
  exit 1
fi

for ((i = 0; i < REP; i++)); do
  svc="kafka-${i}-external"
  ip="${IPS[i]}"
  if ! kubectl get svc "$svc" -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
    echo "⚠️  Service $svc missing — skipping"
    continue
  fi
  echo "▶ $svc ← $ANNOT_KEY=$ip"
  kubectl annotate svc "$svc" -n "$NS" "${ANNOT_KEY}=${ip}" --overwrite --request-timeout=20s
done

echo "✅ Kafka external LoadBalancer IPs pinned (MetalLB will reconcile; restart brokers if advertised.listeners still stale)."
