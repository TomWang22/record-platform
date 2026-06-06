#!/usr/bin/env bash
# BOOT-KAFKA-1 / BOOT-REDIS-1: post-runtime verification before Phase 9.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REPO_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
cd "$_REPO_ROOT"
NS="${HOUSING_NS:-${NAMESPACE:-record-platform}}"

_run() {
  local label="$1"
  shift
  echo "▶ $label"
  HOUSING_NS="$NS" NAMESPACE="$NS" "$@"
}

chmod +x \
  "$_REPO_ROOT/scripts/sync-redis-external-endpoints.sh" \
  "$_REPO_ROOT/scripts/audit-rp-redis-lua-contract.sh" \
  "$_REPO_ROOT/scripts/audit-rp-redis-lua-runtime-contract.sh" \
  "$_REPO_ROOT/scripts/verify-kafka-ready.sh" \
  "$_REPO_ROOT/scripts/rp-verify-kafka-cert-chain.sh" \
  "$_REPO_ROOT/scripts/audit-rp-event-outbox-contract.sh" 2>/dev/null || true

if [[ "${RP_SKIP_REDIS_LUA_GATE:-0}" != "1" ]]; then
  _run "sync-redis-external-endpoints" bash "$_REPO_ROOT/scripts/sync-redis-external-endpoints.sh"
  _run "audit-rp-redis-lua-contract" bash "$_REPO_ROOT/scripts/audit-rp-redis-lua-contract.sh"
  _run "audit-rp-redis-lua-runtime-contract" bash "$_REPO_ROOT/scripts/audit-rp-redis-lua-runtime-contract.sh"
else
  echo "⚠️  RP_SKIP_REDIS_LUA_GATE=1 — skipping Redis/Lua gates"
fi

if [[ "${RP_SKIP_KAFKA_OUTBOX_GATE:-0}" != "1" ]]; then
  _run "verify-kafka-ready" bash "$_REPO_ROOT/scripts/verify-kafka-ready.sh"
  _run "rp-verify-kafka-cert-chain" bash "$_REPO_ROOT/scripts/rp-verify-kafka-cert-chain.sh"
  _run "audit-rp-event-outbox-contract" bash "$_REPO_ROOT/scripts/audit-rp-event-outbox-contract.sh"
else
  echo "⚠️  RP_SKIP_KAFKA_OUTBOX_GATE=1 — skipping Kafka/outbox gates"
fi

echo "✅ rp-bootstrap-post-runtime-gates passed"
exit 0
