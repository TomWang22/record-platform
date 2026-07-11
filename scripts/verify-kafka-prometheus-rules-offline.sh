#!/usr/bin/env bash
# Offline Kafka / observability manifest validation (no Kubernetes API server).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KAFKA_OPS="/tmp/kafka-ops.yaml"
OBSERVABILITY="/tmp/observability.yaml"

kubectl kustomize infra/ops/ >"$KAFKA_OPS"
test -s "$KAFKA_OPS"

kubectl kustomize infra/k8s/base/observability >"$OBSERVABILITY"
test -s "$OBSERVABILITY"

ensure_kubeconform() {
  if command -v kubeconform >/dev/null 2>&1; then
    return 0
  fi
  local version="${KUBECONFORM_VERSION:-v0.6.7}"
  local cache="${REPO_ROOT}/.cache/kubeconform"
  mkdir -p "$cache"
  local bin="$cache/kubeconform"
  if [[ ! -x "$bin" ]]; then
    local os arch
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    arch="$(uname -m)"
    case "$arch" in
      x86_64) arch=amd64 ;;
      aarch64|arm64) arch=arm64 ;;
    esac
    curl -fsSL \
      "https://github.com/yannh/kubeconform/releases/download/${version}/kubeconform-${os}-${arch}.tar.gz" \
      | tar -xz -C "$cache" kubeconform
    chmod +x "$bin"
  fi
  export PATH="$cache:$PATH"
}

ensure_kubeconform

kubeconform -strict -summary \
  -ignore-missing-schemas \
  "$KAFKA_OPS" \
  "$OBSERVABILITY" \
  infra/k8s/base/observability/prometheus-rules-kafka-health.yaml \
  infra/policies/kafka-replica-guard.yaml

python3 tools/bundle-audit/validate_kafka_health_prometheus_rules.py \
  infra/k8s/base/observability/prometheus-rules-kafka-health.yaml

echo "verify-kafka-prometheus-rules-offline: PASS"
