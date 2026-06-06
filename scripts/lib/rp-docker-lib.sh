#!/usr/bin/env bash
# Shared Docker helpers with Colima EOF retry (audit + build gates).
set -euo pipefail

RP_DOCKER="${DOCKER:-docker}"
RP_DOCKER_INSPECT_ATTEMPTS="${RP_DOCKER_INSPECT_ATTEMPTS:-8}"
RP_DOCKER_INSPECT_DELAY_SEC="${RP_DOCKER_INSPECT_DELAY_SEC:-1}"

rp_docker_image_id() {
  local img="$1"
  local attempt=1 id=""
  while [[ $attempt -le $RP_DOCKER_INSPECT_ATTEMPTS ]]; do
    id="$($RP_DOCKER images -q "$img" 2>/dev/null | head -1 || true)"
    [[ -n "$id" ]] && { printf '%s' "$id"; return 0; }
    sleep "$RP_DOCKER_INSPECT_DELAY_SEC"
    attempt=$((attempt + 1))
  done
  return 1
}

rp_docker_inspect_label() {
  local fmt="$1" img="$2"
  local attempt=1 out=""
  while [[ $attempt -le $RP_DOCKER_INSPECT_ATTEMPTS ]]; do
    if out="$($RP_DOCKER image inspect "$img" --format "$fmt" 2>/dev/null)"; then
      printf '%s' "$out"
      return 0
    fi
    if [[ $attempt -lt $RP_DOCKER_INSPECT_ATTEMPTS ]]; then
      sleep "$RP_DOCKER_INSPECT_DELAY_SEC"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

rp_docker_image_exists() {
  rp_docker_image_id "$1" >/dev/null 2>&1
}

rp_docker_image_source_sha() {
  rp_docker_inspect_label '{{index .Config.Labels "rp.dev.source-sha"}}' "$1" 2>/dev/null || true
}

rp_docker_image_fresh_for_service() {
  local svc="$1" tag="${2:-dev}"
  local img="${svc}:${tag}"
  local expected got svc_l rev_l
  expected="$(bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-compute-source-sha.sh" "$svc")"
  rp_docker_image_id "$img" >/dev/null 2>&1 || return 1
  svc_l="$(rp_docker_inspect_label '{{index .Config.Labels "rp.dev.service"}}' "$img" 2>/dev/null || true)"
  got="$(rp_docker_inspect_label '{{index .Config.Labels "rp.dev.source-sha"}}' "$img" 2>/dev/null || true)"
  rev_l="$(rp_docker_inspect_label '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$img" 2>/dev/null || true)"
  [[ -n "$svc_l" && "$svc_l" == "$svc" && -n "$got" && "$got" == "$expected" && -n "$rev_l" && "$rev_l" != "unknown" ]]
}
