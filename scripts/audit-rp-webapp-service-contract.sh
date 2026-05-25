#!/usr/bin/env bash
# webapp Service contract: kustomize render, selector/port, Caddy upstream.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/rp-kustomize-overlay.sh
source "$SCRIPT_DIR/lib/rp-kustomize-overlay.sh"

NS="${RECORD_PLATFORM_NS:-record-platform}"
CF="$REPO_ROOT/Caddyfile"
SVC_FILE="$REPO_ROOT/infra/k8s/base/webapp/service.yaml"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

echo "audit-rp-webapp-service-contract (ns=$NS)"

_manifest="$(mktemp)"
trap 'rm -f "$_manifest"' EXIT
rp_kustomize_build >"$_manifest" || { bad "kustomize build failed"; exit 1; }

ruby -ryaml - "$_manifest" "$NS" <<'RUBY' || { bad "kustomize webapp Service/Deployment contract failed"; exit 1; }
require "yaml"
path, target_ns = ARGV
docs = YAML.load_stream(File.read(path)).compact
svc = dep = nil
docs.each do |doc|
  meta = doc["metadata"] || {}
  svc = doc if doc["kind"] == "Service" && meta["name"] == "webapp"
  dep = doc if doc["kind"] == "Deployment" && meta["name"] == "webapp"
end
abort "FAIL: rendered manifest missing Service/webapp" unless svc
svc_ns = (svc["metadata"] || {})["namespace"] || "default"
abort "FAIL: Service/webapp namespace=#{svc_ns.inspect} (must be #{target_ns.inspect})" unless svc_ns == target_ns
ports = (svc["spec"] || {})["ports"] || []
ok_port = ports.any? { |p| p["port"] == 3001 && p["targetPort"] == 3001 }
abort "FAIL: Service/webapp must expose port 3001 -> targetPort 3001" unless ok_port
abort "FAIL: rendered manifest missing Deployment/webapp" unless dep
dep_ns = (dep["metadata"] || {})["namespace"] || "default"
abort "FAIL: Deployment/webapp namespace=#{dep_ns.inspect} (must be #{target_ns.inspect})" unless dep_ns == target_ns
pod_labels = (((dep["spec"] || {})["template"] || {})["metadata"] || {})["labels"] || {}
selector = (svc["spec"] || {})["selector"] || {}
selector.each do |k, v|
  abort "FAIL: Service selector #{selector.inspect} does not match Deployment pod labels #{pod_labels.inspect}" unless pod_labels[k] == v
end
puts "OK: kustomize Service/webapp + Deployment/webapp contract"
RUBY
ok "kustomize renders Service/webapp in $NS with port 3001 and matching selector"

[[ -f "$SVC_FILE" ]] || bad "missing $SVC_FILE"
grep -q 'namespace: record-platform' "$SVC_FILE" \
  && ok "base webapp/service.yaml declares namespace record-platform" \
  || bad "base webapp/service.yaml must declare namespace: record-platform"

[[ -f "$CF" ]] || bad "missing Caddyfile"
grep -q 'webapp.record-platform.svc.cluster.local:3001' "$CF" \
  && ok "Caddyfile routes to webapp.record-platform.svc.cluster.local:3001" \
  || bad "Caddyfile missing webapp.record-platform.svc.cluster.local:3001"

if grep -qE 'handle @web|@web path' "$CF" && grep -q 'nginx.record-platform.svc.cluster.local:8080' "$CF"; then
  bad "web catch-all still routes to nginx:8080"
elif grep -q 'nginx.record-platform.svc.cluster.local:8080' "$CF"; then
  echo "  ℹ️  nginx:8080 referenced outside web catch-all (ok if not web /)"
else
  ok "no nginx:8080 in Caddyfile web catch-all"
fi

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
echo "✅ audit-rp-webapp-service-contract passed"
