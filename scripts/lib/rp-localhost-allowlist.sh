#!/usr/bin/env bash
# Narrow allowlists for rp-audit-no-localhost-nodeport.sh (sourced, not executed).
# Returns 0 if the line is explicitly allowed despite matching a forbidden pattern.

# transport-watchdog sidecar → api-gateway container in the same Pod (shared netns).
rp_allow_api_gateway_sidecar_watchdog_gateway_url() {
  local file="$1"
  local line="$2"
  [[ "$file" == *infra/k8s/base/api-gateway/deploy.yaml ]] || return 1
  [[ "$line" == *http://127.0.0.1:4000/readyz* ]] || return 1
  # Env name line or YAML value line for transport-watchdog same-pod probe only.
  [[ "$line" == *TRANSPORT_WATCHDOG_GATEWAY_URL* || "$line" == *value:* ]] || return 1
  return 0
}
