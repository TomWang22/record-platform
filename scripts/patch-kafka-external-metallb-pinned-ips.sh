#!/usr/bin/env bash
# Pin stable MetalLB IPs on kafka-N-external Services (annotation metallb.universe.tf/loadBalancerIPs).
# Prevents EXTERNAL advertised.listeners drift when the pool reallocates (e.g. kafka-0 stuck on .240 while LB is .241).
#
# Convention: first IPv4 in METALLB_POOL is reserved for edge (caddy); broker kafka-i uses first + KAFKA_METALLB_FIRST_OFFSET + i.
#   Example METALLB_POOL=192.168.64.240-192.168.64.250, offset 1 → kafka-0=.241, kafka-1=.242, kafka-2=.243
#
# Usage:
#   METALLB_POOL=192.168.64.240-192.168.64.250 HOUSING_NS=record-platform ./scripts/patch-kafka-external-metallb-pinned-ips.sh
# Explicit list (must match replica count):
#   KAFKA_METALLB_PIN_IPS=192.168.64.241,192.168.64.242,192.168.64.243 ./scripts/patch-kafka-external-metallb-pinned-ips.sh
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

OFFSET="${KAFKA_METALLB_FIRST_OFFSET:-1}"
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
    IPS[i]="$(och_kafka_metallb_expected_ip_for_broker "$POOL" "$OFFSET" "$i")" || exit 1
  done
fi

echo "=== patch-kafka-external-metallb-pinned-ips (ns=$NS replicas=$REP) ==="
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
