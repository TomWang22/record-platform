#!/usr/bin/env bash
# Parse rendered kustomize output for Service/Deployment names in a target namespace.
# shellcheck shell=bash
_RP_OBJ_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-kustomize-overlay.sh
source "$_RP_OBJ_LIB_DIR/rp-kustomize-overlay.sh"

RP_KUSTOMIZE_EXPECTED_NS="${RP_KUSTOMIZE_EXPECTED_NS:-record-platform}"

_rp_kustomize_names_for_kind() {
  local kind="$1" ns="${2:-$RP_KUSTOMIZE_EXPECTED_NS}"
  rp_kustomize_build | ruby -ryaml -e '
require "yaml"
kind = ARGV[0]
target_ns = ARGV[1]
names = []
YAML.load_stream($stdin) do |doc|
  next unless doc.is_a?(Hash)
  next unless doc["kind"] == kind
  meta = doc["metadata"] || {}
  name = meta["name"]
  next if name.nil? || name.empty?
  doc_ns = meta["namespace"] || target_ns
  next unless doc_ns == target_ns
  names << name
end
names.uniq.sort.each { |n| puts n }
' "$kind" "$ns"
}

rp_kustomize_expected_services() {
  _rp_kustomize_names_for_kind Service "${1:-$RP_KUSTOMIZE_EXPECTED_NS}"
}

rp_kustomize_expected_deployments() {
  _rp_kustomize_names_for_kind Deployment "${1:-$RP_KUSTOMIZE_EXPECTED_NS}"
}

rp_kustomize_rendered_service_names() {
  rp_kustomize_build | ruby -ryaml -e '
require "yaml"
YAML.load_stream($stdin) do |doc|
  next unless doc.is_a?(Hash) && doc["kind"] == "Service"
  meta = doc["metadata"] || {}
  ns = meta["namespace"] || "(default)"
  puts "#{meta["name"]}\t#{ns}"
end
'
}

rp_print_live_object_names() {
  local kind="$1" ns="${2:-$RP_KUSTOMIZE_EXPECTED_NS}"
  kubectl get "$kind" -n "$ns" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | sort -u | tr '\n' ' '
  echo
}
