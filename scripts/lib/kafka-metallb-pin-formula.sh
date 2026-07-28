#!/usr/bin/env bash
# Single source of truth for kafka-N-external MetalLB pin IPs (must match patch-kafka-external-metallb-pinned-ips.sh).
# Sourced by patch script + verify-kafka-metallb-pin-formula.sh (CI).
# Convention: first IPv4 in METALLB_POOL + KAFKA_METALLB_FIRST_OFFSET + broker_index.
# Default offset is 0 so kafka-0..2 own pool start (.240-.242); ollama/caddy take later free IPs.

if [[ -n "${_RP_KAFKA_METALLB_PIN_FORMULA_LOADED:-}" ]]; then
  return 0
fi
_RP_KAFKA_METALLB_PIN_FORMULA_LOADED=1

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_LIB_DIR/metallb-subnet-guard.sh"

rp_kafka_metallb_add_last_octet() {
  local ip="$1" delta="$2"
  local o1 o2 o3 o4
  IFS=. read -r o1 o2 o3 o4 <<<"$ip"
  local sum=$((10#$o4 + delta))
  if [[ "$sum" -gt 255 ]] || [[ "$sum" -lt 0 ]]; then
    echo "❌ IP last-octet overflow: $ip + $delta" >&2
    return 1
  fi
  printf '%s\n' "${o1}.${o2}.${o3}.${sum}"
}

# Args: METALLB_POOL KAFKA_METALLB_FIRST_OFFSET broker_index (0-based)
rp_kafka_metallb_expected_ip_for_broker() {
  local pool="$1" offset="$2" broker_index="$3"
  local first
  first="$(och_metallb_pool_first_ip "$pool")" || return 1
  rp_kafka_metallb_add_last_octet "$first" $((offset + broker_index))
}
