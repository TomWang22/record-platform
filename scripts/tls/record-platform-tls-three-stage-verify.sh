#!/usr/bin/env bash
# Three-stage TLS for Record Platform / RP-style clusters:
#   Stage 1 — Dev CA + edge leaf material under certs/ (dev-generate-certs.sh).
#   Stage 2 — Kafka broker PKCS12/JKS from dev-root (kafka-ssl-from-dev-root.sh) with
#             serverAuth + clientAuth EKU; local JKS verify (verify-kafka-broker-keystore-jks.sh).
#   Stage 3 — Service mTLS + edge secrets loaded into the cluster (reissue-ca-and-leaf-load-all-services.sh)
#             when kubectl + namespace exist; otherwise print manual hint.
#   Stage 4 (verify) — Optional: cross-broker keystore/truststore parity on kafka-0..N-1
#             (kafka-after-rollout-verify-brokers.sh) when brokers are Running.
#
# Usage (repo root):
#   ./scripts/tls/record-platform-tls-three-stage-verify.sh
#   SKIP_STAGE1=1 SKIP_STAGE3=1 ./scripts/tls/record-platform-tls-three-stage-verify.sh
#   HOUSING_NS=record-platform KAFKA_SSL_EXTRA_IP_SANS=1.2.3.4,5.6.7.8 ./scripts/tls/record-platform-tls-three-stage-verify.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This file lives in scripts/tls/ — repo root is two levels up.
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_SCRIPTS="$REPO_ROOT/scripts"
cd "$REPO_ROOT"

export HOUSING_NS="${HOUSING_NS:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== record-platform-tls-three-stage-verify (HOUSING_NS=$HOUSING_NS) ==="

if [[ "${SKIP_STAGE1:-0}" != "1" ]]; then
  say "Stage 1 — dev CA + edge leaf (certs/)"
  chmod +x "$ROOT_SCRIPTS/dev-generate-certs.sh" 2>/dev/null || true
  bash "$ROOT_SCRIPTS/dev-generate-certs.sh"
  ok "Stage 1 complete"
else
  warn "SKIP_STAGE1=1"
fi

if [[ "${SKIP_STAGE2:-0}" != "1" ]]; then
  say "Stage 2 — Kafka broker JKS (EKU serverAuth + clientAuth)"
  chmod +x "$ROOT_SCRIPTS/kafka-ssl-from-dev-root.sh" "$ROOT_SCRIPTS/verify-kafka-broker-keystore-jks.sh" 2>/dev/null || true
  bash "$ROOT_SCRIPTS/kafka-ssl-from-dev-root.sh"
  bash "$ROOT_SCRIPTS/verify-kafka-broker-keystore-jks.sh"
  ok "Stage 2 complete (local JKS + EKU checks)"
else
  warn "SKIP_STAGE2=1"
fi

if [[ "${SKIP_STAGE3:-0}" != "1" ]]; then
  say "Stage 3 — service mTLS + TLS secrets into cluster"
  if command -v kubectl >/dev/null 2>&1 && kubectl get ns "$HOUSING_NS" --request-timeout=15s >/dev/null 2>&1; then
    chmod +x "$ROOT_SCRIPTS/reissue-ca-and-leaf-load-all-services.sh" 2>/dev/null || true
    HOUSING_NS="$HOUSING_NS" bash "$ROOT_SCRIPTS/reissue-ca-and-leaf-load-all-services.sh" || {
      warn "reissue-ca-and-leaf-load-all-services.sh failed — run manually: HOUSING_NS=$HOUSING_NS pnpm run reissue"
    }
    ok "Stage 3 attempted"
  else
    warn "No kubectl or namespace $HOUSING_NS — skip Stage 3. When cluster exists: HOUSING_NS=$HOUSING_NS pnpm run reissue"
  fi
else
  warn "SKIP_STAGE3=1"
fi

if [[ "${SKIP_BROKER_PARITY:-0}" != "1" ]]; then
  if command -v kubectl >/dev/null 2>&1 && kubectl get ns "$HOUSING_NS" --request-timeout=15s >/dev/null 2>&1 \
    && kubectl get pod kafka-0 -n "$HOUSING_NS" --request-timeout=15s >/dev/null 2>&1; then
    say "Verify — cross-broker keystore/truststore parity (kafka-after-rollout-verify-brokers.sh)"
    chmod +x "$ROOT_SCRIPTS/kafka-after-rollout-verify-brokers.sh" 2>/dev/null || true
    HOUSING_NS="$HOUSING_NS" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" bash "$ROOT_SCRIPTS/kafka-after-rollout-verify-brokers.sh"
    ok "Broker parity check complete"
  else
    warn "Skip broker parity (no kafka-0 in $HOUSING_NS yet). After rollout: HOUSING_NS=$HOUSING_NS ./scripts/kafka-after-rollout-verify-brokers.sh"
  fi
else
  warn "SKIP_BROKER_PARITY=1"
fi

say "Optional cluster gates (when brokers + MetalLB are up):"
echo "  HOUSING_NS=$HOUSING_NS bash scripts/verify-kafka-tls-sans.sh"
echo "  HOUSING_NS=$HOUSING_NS bash scripts/validate-kafka-dns.sh"

ok "record-platform-tls-three-stage-verify done"
