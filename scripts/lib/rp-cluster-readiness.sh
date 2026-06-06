#!/usr/bin/env bash
# Wait for deployments and Service endpoints before runtime contract probes.
set -euo pipefail

rp_wait_deployments_available() {
  local ns="${1:-record-platform}"
  shift
  local dep
  for dep in "$@"; do
    if ! kubectl -n "$ns" get deploy "$dep" >/dev/null 2>&1; then
      echo "⚠️  deploy/$dep not found — skip wait" >&2
      continue
    fi
    echo "Waiting deploy/$dep Available..."
    kubectl -n "$ns" wait "deploy/$dep" --for=condition=Available --timeout=180s
  done
}

rp_wait_service_endpoints() {
  local ns="${1:-record-platform}"
  shift
  local svc ep i
  for svc in "$@"; do
    if ! kubectl -n "$ns" get svc "$svc" >/dev/null 2>&1; then
      echo "⚠️  svc/$svc not found — skip endpoints wait" >&2
      continue
    fi
    ep=""
    for i in $(seq 1 60); do
      ep="$(kubectl -n "$ns" get endpoints "$svc" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
      [[ -n "$ep" ]] && break
      sleep 2
    done
    if [[ -z "$ep" ]]; then
      echo "❌ no endpoints for svc/$svc after 120s" >&2
      return 1
    fi
    echo "✅ svc/$svc endpoints: $ep"
  done
}

rp_curl_with_retry() {
  local max="${1:-5}"
  shift
  local attempt=1 code
  while [[ "$attempt" -le "$max" ]]; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo "000")"
    [[ "$code" == "200" || "$code" == "201" || "$code" == "204" ]] && { echo "$code"; return 0; }
    [[ "$code" == "401" || "$code" == "403" ]] && { echo "$code"; return 0; }
    sleep "$((attempt * 2))"
    attempt=$((attempt + 1))
  done
  echo "${code:-000}"
  return 1
}
