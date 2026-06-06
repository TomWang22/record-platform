#!/usr/bin/env bash
# Ensure record-platform namespace has TLS + Kafka secrets expected by Deployments:
#   - service-tls + dev-root-ca (strict TLS) via ensure-strict-tls-mtls-preflight.sh when missing
#   - edge-service-tls — alias of service-tls (same ca.crt / tls.crt / tls.key)
#   - kafka-ssl-secret — full broker JKS + password files + client mTLS (never partial overwrite)
#
# Skip: PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS=0 or SKIP_AUTO_CLUSTER_SECRETS=1
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-record-platform}"
NS="$HOUSING_NS"
CERTS_DIR="$REPO_ROOT/certs"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

if ! kubectl get ns "$NS" -o name &>/dev/null; then
  warn "Namespace $NS missing — creating it"
  kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=20s
fi

_ensure_rp_service_tls_alias() {
  if ! kubectl -n "$NS" get secret service-tls -o name &>/dev/null; then
    warn "Cannot sync edge-service-tls: service-tls missing"
    return 1
  fi
  local d
  d=$(mktemp -d)
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.ca\.crt}' | base64 -d >"$d/ca.crt"
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.crt}' | base64 -d >"$d/tls.crt"
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.key}' | base64 -d >"$d/tls.key"
  kubectl -n "$NS" create secret generic edge-service-tls \
    --from-file=ca.crt="$d/ca.crt" \
    --from-file=tls.crt="$d/tls.crt" \
    --from-file=tls.key="$d/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f - --request-timeout=20s
  rm -rf "$d"
  ok "edge-service-tls synced from service-tls"
}

_kafka_ssl_secret_complete() {
  python3 - "$NS" <<'PY'
import json, subprocess, sys
ns = sys.argv[1]
required = [
    "kafka.keystore.jks",
    "kafka.truststore.jks",
    "kafka.keystore-password",
    "kafka.truststore-password",
    "kafka-broker.pem",
    "kafka-broker.key",
    "ca-cert.pem",
    "client.crt",
    "client.key",
]
r = subprocess.run(
    ["kubectl", "-n", ns, "get", "secret", "kafka-ssl-secret", "-o", "json"],
    capture_output=True,
    text=True,
)
if r.returncode != 0:
    sys.exit(1)
data = (json.loads(r.stdout).get("data") or {})
missing = [k for k in required if k not in data]
if missing:
    print("missing keys:", ", ".join(missing), file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY
}

_ensure_rp_kafka_ssl_secret() {
  if _kafka_ssl_secret_complete 2>/dev/null; then
    ok "kafka-ssl-secret complete (JKS + passwords + broker + client mTLS)"
    return 0
  fi
  if kubectl -n "$NS" get secret kafka-ssl-secret -o name &>/dev/null 2>&1; then
    warn "kafka-ssl-secret exists but is incomplete — regenerating via kafka-ssl-from-dev-root.sh"
  fi
  if [[ -f "$CERTS_DIR/dev-root.pem" ]] && [[ -f "$CERTS_DIR/dev-root.key" ]]; then
    _has_lb=1
    for ((i = 0; i < 3; i++)); do
      _ip="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
      [[ "$_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || _has_lb=0
    done
    if [[ "$_has_lb" == 1 ]] && [[ -x "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" ]]; then
      HOUSING_NS="$NS" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" && ok "kafka-ssl-secret via refresh+apply" \
        || warn "kafka-refresh-tls-from-lb.sh failed"
    elif [[ -x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
      KAFKA_SSL_NS="$NS" KAFKA_SSL_SKIP_K8S_SECRET=1 KAFKA_SSL_AUTO_METALLB_IPS=0 \
        bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" || warn "kafka-ssl-from-dev-root.sh failed"
      echo "  ℹ️  kafka-ssl-secret deferred until Kafka LB IPs exist; F.cluster_deploy / P5b will run kafka-refresh-tls-from-lb automatically"
    fi
  else
    warn "No certs/dev-root.{pem,key} — run B.crypto or kafka-ssl-from-dev-root.sh"
  fi
}

say "ensure-rp-cluster-secrets (namespace=$NS)"

need_strict=0
if ! kubectl -n "$NS" get secret service-tls -o name &>/dev/null; then
  need_strict=1
elif ! kubectl -n "$NS" get secret dev-root-ca -o name &>/dev/null; then
  need_strict=1
fi

if [[ "$need_strict" -eq 1 ]] && [[ -f "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" ]]; then
  chmod +x "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" 2>/dev/null || true
  if FORCE_TLS_RESTART="${FORCE_TLS_RESTART:-0}" HOUSING_NS="$HOUSING_NS" "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh"; then
    ok "Strict TLS/mTLS preflight provisioned missing secrets"
  else
    warn "ensure-strict-tls-mtls-preflight failed; continuing with alias steps"
  fi
else
  ok "service-tls + dev-root-ca present (skip strict provision)"
fi

_ensure_rp_service_tls_alias || true
_ensure_rp_kafka_ssl_secret || true

say "ensure-rp-cluster-secrets done"
