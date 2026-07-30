#!/usr/bin/env bash
# Canonical dev deploy: namespaces → app-config → RP app manifests → rollouts → edge → endpoints gate.
# External infra (Postgres, Redis) must be up; Kafka should be ready before this script (bootstrap P5d).
#
# Usage: ./scripts/deploy-dev.sh
#   SKIP_SMOKE=1           — do not run smoke test after deploy
#   SKIP_K6=1              — do not run k6 after smoke
#   SKIP_STRICT_ENVELOPE=1 — skip lab vs strict-envelope.json check
#   DEPLOY_OVERLAY=        — kustomize overlay (default: overlays/dev)
#   DEPLOY_SKIP_SMART_IMAGE_ROLLOUT=1 — skip digest-based rollout restarts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/rp-runtime-deploy-services.sh
source "$SCRIPT_DIR/lib/rp-runtime-deploy-services.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }
bad() { echo "❌ $*" >&2; }

NS="${HOUSING_NS:-${RECORD_PLATFORM_NS:-${NAMESPACE:-record-platform}}}"
export HOUSING_NS="$NS"
KUST_DIR="$REPO_ROOT/infra/k8s"
DEPLOY_OVERLAY="${DEPLOY_OVERLAY:-overlays/dev}"

# 1) k3s / context
if ! kubectl config current-context &>/dev/null; then
  bad "No kube context. Start Colima/k3s and ensure kubectl points at the cluster."
  exit 1
fi
ok "Context: $(kubectl config current-context)"

# 2) Namespace(s)
for n in "$NS" ingress-nginx envoy-test observability; do
  kubectl create namespace "$n" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=30s 2>/dev/null || true
done
ok "Namespaces present"

# 3) Secrets (must exist; create via strict-tls-bootstrap / rotate-ca etc.)
if ! kubectl get secret -n "$NS" app-secrets &>/dev/null 2>&1; then
  warn "app-secrets not found in $NS. Create TLS/secrets first (e.g. scripts/strict-tls-bootstrap.sh)."
fi
LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-record-platform-local-tls}"
if ! kubectl get secret -n ingress-nginx "$LEAF_TLS_SECRET" &>/dev/null 2>&1 || ! kubectl get secret -n ingress-nginx dev-root-ca &>/dev/null 2>&1; then
  warn "Caddy TLS secrets ($LEAF_TLS_SECRET, dev-root-ca) missing in ingress-nginx. Run scripts/rollout-caddy.sh after B.crypto / ensure-rp-cluster-secrets."
fi

# 4) ConfigMap + proto-files (grpc-clients loads records.proto at import)
if [[ -x "$SCRIPT_DIR/rp-sync-proto-configmap.sh" ]]; then
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/rp-sync-proto-configmap.sh"
  ok "proto-files + app-config applied"
elif [[ -d "$KUST_DIR/base/config" ]]; then
  bash "$SCRIPT_DIR/sync-proto-to-k8s.sh" 2>/dev/null || true
  kubectl apply -f "$KUST_DIR/base/config/app-config.yaml" -n "$NS" --request-timeout=30s
  ok "ConfigMap app-config applied (proto sync skipped)"
fi

# 4b) Strict envelope
if [[ "${SKIP_STRICT_ENVELOPE:-0}" != "1" ]] && command -v node &>/dev/null; then
  say "Strict envelope check (capacity-recommendations vs infra/k8s/base/config/strict-envelope.json)..."
  if ! node "$REPO_ROOT/scripts/protocol/strict-envelope-check.js" --perf-dir "$REPO_ROOT/bench_logs/performance-lab"; then
    bad "Strict envelope check failed. Refresh strict-envelope.json or set SKIP_STRICT_ENVELOPE=1 (not for production)."
    exit 1
  fi
  ok "Strict envelope OK"
fi

# 5) Apply RP app manifests (Deployments + Services) — fail fast
chmod +x "$SCRIPT_DIR/rp-verify-kustomize-app-services.sh" "$SCRIPT_DIR/rp-apply-rp-app-manifests.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/rp-apply-rp-app-manifests.sh"

# Kustomize must not regenerate kafka-ssl-secret (see base/secrets/kustomization.yaml).
# Re-apply full broker JKS + client mTLS after manifest apply in case an older overlay wiped keys.
if [[ -x "$SCRIPT_DIR/rp-ensure-kafka-ssl-clients.sh" ]]; then
  HOUSING_NS="$NS" RP_KAFKA_SSL_RESTART_APPS=1 bash "$SCRIPT_DIR/rp-ensure-kafka-ssl-clients.sh" || {
    bad "kafka-ssl-secret missing client mTLS after apply — run: bash scripts/kafka-ssl-from-dev-root.sh && HOUSING_NS=$NS bash scripts/apply-rp-kafka-ssl-secret.sh"
    exit 1
  }
  ok "kafka-ssl client mTLS verified (post-apply)"
fi

bash "$SCRIPT_DIR/rp-clamp-ollama-hpa-dev.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/apply-ollama-metallb-lb.sh" 2>/dev/null || true

say "Reconciling missing Record Platform Deployments (per-app base bundles if overlay reconcile lagged)…"
_missing_reconcile=()
for svc in ollama "${RP_RUNTIME_APP_DEPLOYS[@]}" webapp; do
  if kubectl get deployment "$svc" -n "$NS" --request-timeout=15s &>/dev/null; then
    continue
  fi
  if [[ -d "$KUST_DIR/base/$svc" ]]; then
    warn "deployment/$svc missing in $NS — applying kustomize base/$svc"
    kubectl apply -k "$KUST_DIR/base/$svc" -n "$NS" --request-timeout=120s || _missing_reconcile+=("$svc")
  else
    _missing_reconcile+=("$svc")
  fi
done
if [[ ${#_missing_reconcile[@]} -gt 0 ]]; then
  bad "RP app Deployment reconcile failed: ${_missing_reconcile[*]}"
  kubectl get deploy -n "$NS" 2>&1 | head -30 >&2 || true
  exit 1
fi

say "Reconciling missing Record Platform Services (webapp ClusterIP for Caddy /)…"
_missing_svc_reconcile=()
for svc in webapp; do
  if kubectl get svc "$svc" -n "$NS" --request-timeout=15s &>/dev/null; then
    continue
  fi
  if [[ -f "$KUST_DIR/base/$svc/service.yaml" ]]; then
    warn "service/$svc missing in $NS — applying infra/k8s/base/$svc/service.yaml"
    kubectl apply -f "$KUST_DIR/base/$svc/service.yaml" -n "$NS" --request-timeout=120s || _missing_svc_reconcile+=("$svc")
  elif [[ -d "$KUST_DIR/base/$svc" ]]; then
    warn "service/$svc missing in $NS — applying kustomize base/$svc"
    kubectl apply -k "$KUST_DIR/base/$svc" -n "$NS" --request-timeout=120s || _missing_svc_reconcile+=("$svc")
  else
    _missing_svc_reconcile+=("$svc")
  fi
done
if [[ ${#_missing_svc_reconcile[@]} -gt 0 ]]; then
  bad "RP app Service reconcile failed: ${_missing_svc_reconcile[*]}"
  kubectl get svc -n "$NS" 2>&1 | head -30 >&2 || true
  exit 1
fi

# 6) Smart rollout (digest mismatch only)
if [[ -f "$SCRIPT_DIR/smart-rollout-rp-if-image-changed.sh" ]]; then
  say "Smart rollout — restart Deployments only when host Docker :dev digest ≠ pod imageID…"
  bash "$SCRIPT_DIR/smart-rollout-rp-if-image-changed.sh"
fi

# 7) App deployment rollouts (required resources must exist)
say "Waiting for Record Platform deployments (readiness)…"
_rollout_fail=()
for dep in ollama "${RP_RUNTIME_APP_DEPLOYS[@]}" webapp; do
  if ! kubectl get deployment -n "$NS" "$dep" --request-timeout=15s &>/dev/null; then
    bad "Deployment/$dep missing in $NS after manifest apply"
    _rollout_fail+=("$dep:missing")
    continue
  fi
  if ! kubectl rollout status deployment/"$dep" -n "$NS" --timeout=600s; then
    _rollout_fail+=("$dep:rollout")
    continue
  fi
  ok "$dep ready"
done
if [[ ${#_rollout_fail[@]} -gt 0 ]]; then
  bad "Deployment rollout failures: ${_rollout_fail[*]}"
  exit 1
fi

# 8) webapp Service + endpoints (Caddy / → webapp:3001)
say "webapp Service contract before Caddy rollout…"
if ! kubectl get svc webapp -n "$NS" --request-timeout=15s &>/dev/null; then
  bad "webapp Service missing in $NS — Caddy / will 502"
  exit 1
fi
ok "webapp Service exists in $NS"
if ! kubectl wait deployment/webapp -n "$NS" --for=condition=Available --timeout=240s; then
  bad "deployment/webapp not Available in $NS"
  exit 1
fi
ok "webapp Deployment Available"
_webapp_ep_deadline=$(( $(date +%s) + 240 ))
while [[ $(date +%s) -lt $_webapp_ep_deadline ]]; do
  _webapp_addrs="$(kubectl get endpoints webapp -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
  if [[ "${_webapp_addrs:-0}" -ge 1 ]]; then
    ok "webapp endpoints ready"
    break
  fi
  sleep 3
done
if [[ "${_webapp_addrs:-0}" -lt 1 ]]; then
  bad "webapp has no ready endpoints within 240s"
  exit 1
fi

# 9) API gateway Service must exist before edge (Caddy health checks)
if ! kubectl get svc api-gateway -n "$NS" --request-timeout=15s &>/dev/null; then
  bad "api-gateway Service missing in $NS — edge rollout blocked"
  exit 1
fi
ok "api-gateway Service exists before Caddy rollout"

# 8b) Re-sync redis-external after app pods are ready (gateway IP + pod PING; P6a may run too early)
if [[ -x "$SCRIPT_DIR/sync-redis-external-endpoints.sh" ]]; then
  HOUSING_NS="$NS" K8S_NAMESPACE="$NS" bash "$SCRIPT_DIR/sync-redis-external-endpoints.sh" || {
    bad "redis-external sync/verify failed after rollouts — Compose redis must be reachable from pods"
    exit 1
  }
  ok "redis-external verified from pod (post-rollout)"
fi

# 9) Caddy + Envoy (after app Services exist)
[[ -f "$SCRIPT_DIR/rollout-caddy.sh" ]] && "$SCRIPT_DIR/rollout-caddy.sh"
if kubectl get deployment envoy-test -n envoy-test --request-timeout=15s &>/dev/null; then
  kubectl rollout restart deployment/envoy-test -n envoy-test --request-timeout=30s 2>/dev/null || true
  kubectl rollout status deployment/envoy-test -n envoy-test --timeout=180s
  ok "envoy-test rolled out"
fi

# 10) Service Endpoints gate (hard fail — no silent 502s)
say "Waiting for Record Platform Service Endpoints (before smoke)…"
chmod +x "$SCRIPT_DIR/wait-for-platform-service-endpoints.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/wait-for-platform-service-endpoints.sh"

# 11) Smoke test
if [[ "${SKIP_SMOKE:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/smoke-test-dev.sh" ]]; then
  say "Running smoke test..."
  "$SCRIPT_DIR/smoke-test-dev.sh" || warn "Smoke test had failures"
fi

# 12) Optional k6
if [[ "${SKIP_K6:-1}" != "1" ]] && [[ -f "$SCRIPT_DIR/load/run-k6-phases.sh" ]]; then
  export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
  if [[ -s "${K6_CA_ABSOLUTE:-}" ]]; then
    say "Running k6 (messaging phase)..."
    K6_PHASES=messaging "$SCRIPT_DIR/load/run-k6-phases.sh" || true
  fi
fi

ok "Deploy-dev complete."
