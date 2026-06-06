#!/usr/bin/env bash
# Shared helpers for infra/k8s/overlays/dev (build, apply, manifest checksum).
# shellcheck shell=bash
RP_KUSTOMIZE_ROOT="${RP_KUSTOMIZE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
RP_KUSTOMIZE_OVERLAY_REL="${RP_KUSTOMIZE_OVERLAY_REL:-${DEPLOY_OVERLAY:-overlays/dev}}"
RP_KUSTOMIZE_OVERLAY_DIR="${RP_KUSTOMIZE_OVERLAY_DIR:-$RP_KUSTOMIZE_ROOT/infra/k8s/$RP_KUSTOMIZE_OVERLAY_REL}"
RP_KUSTOMIZE_MANIFEST_STAMP="${RP_KUSTOMIZE_MANIFEST_STAMP:-$RP_KUSTOMIZE_ROOT/bench_logs/last-deployed-kustomize-manifest.sha256}"
RP_KUSTOMIZE_MANIFEST_JSON="${RP_KUSTOMIZE_MANIFEST_JSON:-$RP_KUSTOMIZE_ROOT/bench_logs/last-deployed-kustomize-manifest.json}"

rp_kustomize_build() {
  local od="${1:-$RP_KUSTOMIZE_OVERLAY_DIR}"
  if [[ ! -d "$od" ]]; then
    echo "❌ kustomize overlay not found: $od" >&2
    return 1
  fi
  if command -v kustomize >/dev/null 2>&1; then
    kustomize build "$od"
  else
    kubectl kustomize "$od"
  fi
}

rp_kustomize_manifest_sha256() {
  rp_kustomize_build "$@" | if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | awk '{print $1}'
}

rp_record_kustomize_manifest_stamp() {
  local od="${1:-$RP_KUSTOMIZE_OVERLAY_DIR}"
  mkdir -p "$(dirname "$RP_KUSTOMIZE_MANIFEST_STAMP")"
  local sum
  sum="$(rp_kustomize_manifest_sha256 "$od")" || return 1
  printf '%s\n' "$sum" >"$RP_KUSTOMIZE_MANIFEST_STAMP"
  printf '%s\n' "{\"overlay\":\"$RP_KUSTOMIZE_OVERLAY_REL\",\"sha256\":\"$sum\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >"$RP_KUSTOMIZE_MANIFEST_JSON"
}
