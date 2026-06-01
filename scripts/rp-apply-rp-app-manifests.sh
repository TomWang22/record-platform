#!/usr/bin/env bash
# Apply RP app overlay (Deployments + Services) and fail fast if resources are missing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-${RECORD_PLATFORM_NS:-${NAMESPACE:-record-platform}}}"
APPLY_VERIFY_ATTEMPTS="${RP_APPLY_VERIFY_ATTEMPTS:-30}"
APPLY_VERIFY_SLEEP="${RP_APPLY_VERIFY_SLEEP:-2}"

# shellcheck source=scripts/lib/rp-kustomize-overlay.sh
source "$SCRIPT_DIR/lib/rp-kustomize-overlay.sh"
# shellcheck source=scripts/lib/rp-kustomize-expected-objects.sh
source "$SCRIPT_DIR/lib/rp-kustomize-expected-objects.sh"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }
warn() { echo "⚠️  $*"; }

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

chmod +x "$SCRIPT_DIR/rp-verify-kustomize-app-services.sh" \
  "$SCRIPT_DIR/audit-rp-webapp-service-contract.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/audit-rp-webapp-service-contract.sh" || {
  bad "webapp Service contract audit failed — fix manifests before apply"
  exit 1
}
bash "$SCRIPT_DIR/rp-verify-kustomize-app-services.sh" || {
  bad "preflight kustomize contract failed — not applying manifests"
  exit 1
}

# Legacy mis-namespaced webapp Service (base/service.yaml lacked namespace until 2026-05).
if kubectl get svc webapp -n default --request-timeout=5s &>/dev/null; then
  warn "deleting orphan service/webapp in default namespace (must be $NS)"
  kubectl delete svc webapp -n default --request-timeout=30s || true
fi

say "[P6a] RP app manifests — deployments + services (overlay $RP_KUSTOMIZE_OVERLAY_REL → ns=$NS)"
_apply_log="$(mktemp)"
trap 'rm -f "$_apply_log"' EXIT

if ! rp_kustomize_build | kubectl apply -f - 2>&1 | tee "$_apply_log"; then
  bad "kubectl apply failed for $RP_KUSTOMIZE_OVERLAY_DIR"
  echo "  log tail:" >&2
  tail -40 "$_apply_log" >&2
  exit 1
fi

# redis-external Endpoints are patched post-apply (Compose IP; cannot use 127.0.0.1 in manifests).
if [[ -x "$SCRIPT_DIR/sync-redis-external-endpoints.sh" ]]; then
  HOUSING_NS="$NS" K8S_NAMESPACE="$NS" bash "$SCRIPT_DIR/sync-redis-external-endpoints.sh" || {
    bad "sync-redis-external-endpoints failed — is Docker Compose redis up?"
    exit 1
  }
  ok "redis-external Endpoints synced from Compose"
fi

rp_record_kustomize_manifest_stamp || bad "could not record manifest checksum"
ok "Recorded manifest checksum → bench_logs/last-deployed-kustomize-manifest.{sha256,json}"

mapfile -t _expected_svc < <(rp_kustomize_expected_services "$NS")
mapfile -t _expected_dep < <(rp_kustomize_expected_deployments "$NS")

_missing_svc=()
_missing_dep=()
for ((attempt = 1; attempt <= APPLY_VERIFY_ATTEMPTS; attempt++)); do
  _missing_svc=()
  _missing_dep=()
  for svc in "${_expected_svc[@]}"; do
    kubectl get svc "$svc" -n "$NS" --request-timeout=10s >/dev/null 2>&1 || _missing_svc+=("$svc")
  done
  for dep in "${_expected_dep[@]}"; do
    kubectl get deploy "$dep" -n "$NS" --request-timeout=10s >/dev/null 2>&1 || _missing_dep+=("$dep")
  done
  if [[ ${#_missing_svc[@]} -eq 0 && ${#_missing_dep[@]} -eq 0 ]]; then
  ok "all required RP Services (${#_expected_svc[@]}) and Deployments (${#_expected_dep[@]}) exist in $NS (attempt $attempt/$APPLY_VERIFY_ATTEMPTS)"
    exit 0
  fi
  [[ "$attempt" -lt "$APPLY_VERIFY_ATTEMPTS" ]] && sleep "$APPLY_VERIFY_SLEEP"
done

bad "RP app Service/Deployment apply incomplete in $NS (after ${APPLY_VERIFY_ATTEMPTS} attempts)"
echo "  expected Services (${#_expected_svc[@]}): ${_expected_svc[*]}" >&2
echo "  live Services: $(rp_print_live_object_names svc "$NS")" >&2
[[ ${#_missing_svc[@]} -gt 0 ]] && echo "  missing Service: ${_missing_svc[*]}" >&2
echo "  expected Deployments (${#_expected_dep[@]}): ${_expected_dep[*]}" >&2
echo "  live Deployments: $(rp_print_live_object_names deploy "$NS")" >&2
[[ ${#_missing_dep[@]} -gt 0 ]] && echo "  missing Deployment: ${_missing_dep[*]}" >&2
echo "  kubectl get svc,deploy -n $NS" >&2
kubectl get svc,deploy -n "$NS" 2>&1 | head -50 >&2 || true
echo "  rendered Services (name → namespace):" >&2
rp_kustomize_rendered_service_names | head -40 >&2 || true
exit 1
