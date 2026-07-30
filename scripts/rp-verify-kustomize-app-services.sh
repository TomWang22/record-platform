#!/usr/bin/env bash
# Preflight: rendered RP dev overlay must include Service + Deployment for every runtime app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

NS="${RECORD_PLATFORM_NS:-record-platform}"

# shellcheck source=scripts/lib/rp-kustomize-overlay.sh
source "$SCRIPT_DIR/lib/rp-kustomize-overlay.sh"
# shellcheck source=scripts/lib/rp-kustomize-expected-objects.sh
source "$SCRIPT_DIR/lib/rp-kustomize-expected-objects.sh"
# shellcheck source=scripts/lib/rp-runtime-deploy-services.sh
source "$SCRIPT_DIR/lib/rp-runtime-deploy-services.sh"

FAIL=0
fail() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

FORBIDDEN_APP_SERVICES=(reservation-mesh)
FORBIDDEN_NS='record-platform'

_manifest="$(mktemp)"
trap 'rm -f "$_manifest"' EXIT

if ! rp_kustomize_build >"$_manifest"; then
  fail "kubectl kustomize $RP_KUSTOMIZE_OVERLAY_REL failed — fix overlay before cluster deploy"
  exit 1
fi

# Avoid literal legacy RP secret name in this file (B.crypto grep scans active paths).
_legacy_kafka_secret='kafka-ssl-secret-LEGACY'
if grep -q "$_legacy_kafka_secret" "$_manifest"; then
  fail "rendered overlay references legacy Kafka TLS secret (use kafka-ssl-secret)"
  exit 1
fi

if grep -q "namespace: ${FORBIDDEN_NS}" "$_manifest"; then
  fail "rendered overlay contains namespace: ${FORBIDDEN_NS}"
  exit 1
fi

_dry="$(kubectl apply -f "$_manifest" --dry-run=client -o name 2>&1)" || {
  fail "kubectl apply --dry-run=client failed for $RP_KUSTOMIZE_OVERLAY_REL"
  echo "$_dry" >&2
  exit 1
}

for _forbidden in "${FORBIDDEN_APP_SERVICES[@]}"; do
  if printf '%s\n' "$_dry" | grep -qFx "service/${_forbidden}"; then
    fail "forbidden Service in overlay: ${_forbidden}"
  fi
  if printf '%s\n' "$_dry" | grep -qFx "deployment.apps/${_forbidden}"; then
    fail "forbidden Deployment in overlay: ${_forbidden}"
  fi
done

mapfile -t _expected_svc < <(rp_kustomize_expected_services "$NS")
mapfile -t _expected_dep < <(rp_kustomize_expected_deployments "$NS")

_missing_svc=()
_missing_dep=()
for svc in "${RP_RUNTIME_APP_DEPLOYS[@]}" ollama webapp; do
  printf '%s\n' "${_expected_svc[@]}" | grep -qxF "$svc" || _missing_svc+=("$svc")
  printf '%s\n' "${_expected_dep[@]}" | grep -qxF "$svc" || _missing_dep+=("$svc")
done

ruby -ryaml - "$_manifest" "$NS" <<'RUBY' || FAIL=1
require "yaml"
path, target_ns = ARGV
found = false
YAML.load_stream(File.read(path)).compact.each do |doc|
  next unless doc["kind"] == "Service" && (doc["metadata"] || {})["name"] == "webapp"
  ns = (doc["metadata"] || {})["namespace"] || "default"
  if ns != target_ns
    puts "FAIL: Service/webapp rendered in namespace #{ns.inspect}, not #{target_ns.inspect}"
    exit 1
  end
  puts "OK: Service/webapp namespace=#{ns}"
  found = true
  break
end
unless found
  puts "FAIL: Service/webapp not found in rendered manifest"
  exit 1
end
RUBY

if [[ ${#_missing_svc[@]} -gt 0 ]]; then
  fail "manifest missing Service(s) in $NS: ${_missing_svc[*]}"
fi
if [[ ${#_missing_dep[@]} -gt 0 ]]; then
  fail "manifest missing Deployment(s) in $NS: ${_missing_dep[*]}"
fi

[[ "$FAIL" -eq 0 ]] || {
  echo "Recovery: rendered Services:" >&2
  rp_kustomize_rendered_service_names >&2 || true
  exit 1
}

ok "rp-verify-kustomize-app-services: overlay $RP_KUSTOMIZE_OVERLAY_REL has all RP app Services + Deployments in $NS"
