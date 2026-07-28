#!/usr/bin/env bash
# CI / local: assert MetalLB pin IP math matches scripts/lib/kafka-metallb-pin-formula.sh (contract for kafka-*-external).
# No cluster required for table tests. Optional: if kubectl + kafka-0-external exist, assert annotation matches formula.
#
# Usage: ./scripts/verify-kafka-metallb-pin-formula.sh
# Env: HOUSING_NS, METALLB_POOL, KAFKA_METALLB_FIRST_OFFSET, KAFKA_BROKER_REPLICAS (for optional live check)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/kafka-metallb-pin-formula.sh"

FAIL=0

_assert_row() {
  local pool="$1" off="$2" rep="$3"
  shift 3
  local i got want
  for ((i = 0; i < rep; i++)); do
    want="$1"
    shift
    got="$(rp_kafka_metallb_expected_ip_for_broker "$pool" "$off" "$i")" || {
      echo "❌ formula error pool=$pool off=$off i=$i" >&2
      FAIL=1
      return
    }
    if [[ "$got" != "$want" ]]; then
      echo "❌ expected_ip broker $i: want $want got $got (pool=$pool offset=$off)" >&2
      FAIL=1
    fi
  done
}

echo "=== verify-kafka-metallb-pin-formula (table tests) ==="
# Colima / cold-bootstrap default: offset 0 (kafka owns pool start; avoids ollama-lb on .243)
_assert_row "192.168.64.240-192.168.64.250" 0 3 192.168.64.240 192.168.64.241 192.168.64.242
_assert_row "172.18.0.240-172.18.0.250" 0 3 172.18.0.240 172.18.0.241 172.18.0.242
# offset 1 still supported (legacy / dedicated kafka pool) but collides with ollama on shared Colima pool
_assert_row "192.168.64.240-192.168.64.250" 1 3 192.168.64.241 192.168.64.242 192.168.64.243
_assert_row "10.0.0.100-10.0.0.110" 0 2 10.0.0.100 10.0.0.101

if [[ "$FAIL" -ne 0 ]]; then
  echo "❌ verify-kafka-metallb-pin-formula: table tests failed" >&2
  exit 1
fi
echo "✅ Table tests passed"

# Optional live check (self-hosted runner / dev with cluster)
NS="${HOUSING_NS:-record-platform}"
POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
OFF="${KAFKA_METALLB_FIRST_OFFSET:-0}"
REP="${KAFKA_BROKER_REPLICAS:-3}"

if command -v kubectl >/dev/null 2>&1 && kubectl get svc kafka-0-external -n "$NS" --request-timeout=10s >/dev/null 2>&1; then
  echo "=== verify-kafka-metallb-pin-formula (live annotation vs formula, ns=$NS) ==="
  for ((i = 0; i < REP; i++)); do
    want="$(rp_kafka_metallb_expected_ip_for_broker "$POOL" "$OFF" "$i")"
    got="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o go-template='{{index .metadata.annotations "metallb.universe.tf/loadBalancerIPs"}}' --request-timeout=15s 2>/dev/null || true)"
    if [[ -z "$got" ]]; then
      echo "⚠️  kafka-${i}-external: no metallb pin annotation (OK for fresh cluster)" >&2
      continue
    fi
    if [[ "$got" != "$want" ]]; then
      echo "❌ kafka-${i}-external annotation: want $want got $got" >&2
      FAIL=1
    else
      echo "✅ kafka-${i}-external ← $got"
    fi
  done
  [[ "$FAIL" -eq 0 ]] || exit 1
else
  echo "ℹ️  Skipping live check (no kubectl or no kafka-0-external in $NS)"
fi

echo "✅ verify-kafka-metallb-pin-formula complete"
