#!/usr/bin/env bash
# shellcheck shell=bash
# Unified Jaeger Query API base for host-run acceptance tooling.
#
# ACCEPTANCE CONTRACT (fail closed):
#   RP_JAEGER_QUERY_URL / RP_JAEGER_QUERY_HOST / RP_JAEGER_QUERY_METALLB_IP / RP_JAEGER_QUERY_CA_FILE
# must match infra/contracts/rp-jaeger-query-endpoint-contract.json.
#
# No localhost, no kubectl port-forward, no silent edge discovery, no alternate fallbacks.
#
# Exports JAEGER_QUERY_BASE on success. Returns 0 if usable base set, 1 otherwise.

rp_jaeger_services_curl_ok() {
  local base="${1%/}"
  [[ -z "$base" ]] && return 1
  local ca="${RP_JAEGER_QUERY_CA_FILE:-${NODE_EXTRA_CA_CERTS:-}}"
  [[ -z "$ca" || ! -f "$ca" ]] && ca="${REPO_ROOT:-}/certs/dev-chain.pem"
  [[ -f "$ca" ]] || ca="${REPO_ROOT:-}/certs/dev-root.pem"
  local c=(curl -sfS --max-time 10 --connect-timeout 5)
  [[ -f "$ca" ]] && c+=(--cacert "$ca")
  # Acceptance: normal DNS only — never --resolve / localhost / port-forward.
  if [[ "$base" == https:* ]]; then
    "${c[@]}" "${base}/api/services" >/dev/null 2>&1 && return 0
    return 1
  fi
  return 1
}

rp_jaeger_resolve_query_base() {
  local repo_root="${REPO_ROOT:-}"
  if [[ -z "$repo_root" ]]; then
    local _libdir
    _libdir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ "$_libdir" == *"/scripts/lib" ]]; then
      repo_root="$(cd "$_libdir/../.." && pwd)"
    else
      repo_root="$(cd "$_libdir/.." && pwd)"
    fi
  fi
  export REPO_ROOT="$repo_root"

  local contract="$repo_root/infra/contracts/rp-jaeger-query-endpoint-contract.json"
  if [[ ! -f "$contract" ]]; then
    echo "Jaeger: missing contract $contract" >&2
    return 1
  fi

  # Load contract defaults; env overrides must still match hostname/IP when set.
  eval "$(python3 - <<'PY' "$contract"
import json, os, sys
c = json.load(open(sys.argv[1]))
env = c.get("env_contract") or {}
print(f"export RP_JAEGER_QUERY_URL={os.environ.get('RP_JAEGER_QUERY_URL', env['RP_JAEGER_QUERY_URL'])!r}")
print(f"export RP_JAEGER_QUERY_HOST={os.environ.get('RP_JAEGER_QUERY_HOST', env['RP_JAEGER_QUERY_HOST'])!r}")
print(f"export RP_JAEGER_QUERY_METALLB_IP={os.environ.get('RP_JAEGER_QUERY_METALLB_IP', env['RP_JAEGER_QUERY_METALLB_IP'])!r}")
print(f"export RP_JAEGER_QUERY_CA_FILE={os.environ.get('RP_JAEGER_QUERY_CA_FILE', env['RP_JAEGER_QUERY_CA_FILE'])!r}")
print(f"_CONTRACT_HOST={c['hostname']!r}")
print(f"_CONTRACT_IP={c['metallb']['loadBalancerIP']!r}")
print(f"_CONTRACT_URL={c['url_base']!r}")
PY
)"

  # Resolve relative CA path
  if [[ "${RP_JAEGER_QUERY_CA_FILE}" != /* ]]; then
    export RP_JAEGER_QUERY_CA_FILE="$repo_root/${RP_JAEGER_QUERY_CA_FILE}"
  fi

  if [[ "$RP_JAEGER_QUERY_HOST" != "$_CONTRACT_HOST" ]]; then
    echo "Jaeger: RP_JAEGER_QUERY_HOST=$RP_JAEGER_QUERY_HOST != contract $_CONTRACT_HOST" >&2
    return 1
  fi
  if [[ "$RP_JAEGER_QUERY_METALLB_IP" != "$_CONTRACT_IP" ]]; then
    echo "Jaeger: RP_JAEGER_QUERY_METALLB_IP=$RP_JAEGER_QUERY_METALLB_IP != contract $_CONTRACT_IP" >&2
    return 1
  fi
  if [[ "${RP_JAEGER_QUERY_URL%/}" != "${_CONTRACT_URL%/}" ]]; then
    echo "Jaeger: RP_JAEGER_QUERY_URL=$RP_JAEGER_QUERY_URL != contract $_CONTRACT_URL" >&2
    return 1
  fi

  # DNS must resolve to MetalLB IP (no silent --resolve-only acceptance without hosts)
  local resolved
  resolved="$(python3 -c "import socket; print(socket.gethostbyname('$RP_JAEGER_QUERY_HOST'))" 2>/dev/null || true)"
  if [[ "$resolved" != "$RP_JAEGER_QUERY_METALLB_IP" ]]; then
    echo "Jaeger: DNS $RP_JAEGER_QUERY_HOST → '${resolved:-none}' expected $RP_JAEGER_QUERY_METALLB_IP" >&2
    echo "hint: scripts/ensure-jaeger-query-hosts.sh" >&2
    return 1
  fi

  if rp_jaeger_services_curl_ok "$RP_JAEGER_QUERY_URL"; then
    export JAEGER_QUERY_BASE="${RP_JAEGER_QUERY_URL%/}"
    echo "Jaeger: JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (MetalLB contract)"
    return 0
  fi

  echo "Jaeger: MetalLB query URL not ready: $RP_JAEGER_QUERY_URL" >&2
  return 1
}
