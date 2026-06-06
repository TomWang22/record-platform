#!/usr/bin/env bash
# Shared helpers: edge-only E2E / k6 (https://record-platform.test), no port-forward / :4000.
# Use record-platform.test in /etc/hosts → MetalLB IP (no localhost / NodePort edge).
# shellcheck shell=bash

EDGE_TEST_DEFAULT_BASE="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"

# Print normalized E2E API base to stdout; warnings on stderr. Rejects legacy port-forward URLs.
edge_normalize_e2e_api_base() {
  local raw="${E2E_API_BASE:-}"
  raw="${raw%/}"
  if [[ -z "$raw" ]]; then
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" =~ ^http://127\.0\.0\.1:4000 ]] || [[ "$raw" =~ ^http://localhost:4000 ]]; then
    echo "⚠️  Ignoring legacy E2E_API_BASE=$raw (port-forward / direct :4000 removed for E2E). Using $EDGE_TEST_DEFAULT_BASE" >&2
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" != https://* ]]; then
    echo "❌ E2E_API_BASE must be https://… (got: $raw). Unset it or set to $EDGE_TEST_DEFAULT_BASE" >&2
    return 1
  fi
  printf '%s\n' "$raw"
}

# Print normalized BASE_URL for k6 (from env BASE_URL). Same rules as E2E.
edge_normalize_k6_base_url() {
  local raw="${BASE_URL:-}"
  raw="${raw%/}"
  if [[ -z "$raw" ]]; then
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" =~ ^http://127\.0\.0\.1:4000 ]] || [[ "$raw" =~ ^http://localhost:4000 ]]; then
    echo "⚠️  Ignoring legacy BASE_URL=$raw. Using $EDGE_TEST_DEFAULT_BASE" >&2
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" != https://* ]]; then
    echo "❌ BASE_URL must be https://… (got: $raw)" >&2
    return 1
  fi
  printf '%s\n' "$raw"
}

edge_hostname_from_https_url() {
  printf '%s\n' "$1" | sed -E 's|^https://([^/:?#]+).*|\1|'
}

# Best-effort: first LoadBalancer IP from common ingress / caddy services (app namespace).
edge_hint_lb_ip_for_och() {
  local ns="${HOUSING_NS:-record-platform}"
  local ip=""
  if command -v kubectl >/dev/null 2>&1; then
    ip="$(kubectl get svc -n ingress-nginx -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' 2>/dev/null | head -1 | tr -d '\r')"
    [[ -z "$ip" ]] && ip="$(kubectl get svc -n "$ns" -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' 2>/dev/null | head -1 | tr -d '\r')"
  fi
  [[ -n "$ip" ]] && printf '%s\n' "$ip"
}

# Print copy-paste curl --resolve and optional /etc/hosts line (MetalLB / Colima pool).
edge_print_resolve_and_hosts_hint() {
  local host="$1"
  local ip="${2:-}"
  [[ -z "$ip" ]] && ip="$(edge_hint_lb_ip_for_och || true)"
  if [[ -z "$ip" ]]; then
    echo "  (Could not discover LB IP — set OCH_EDGE_IP=... from: kubectl get svc -A | grep LoadBalancer)" >&2
    return 0
  fi
  echo "  curl TLS examples use SNI + MetalLB IP:" >&2
  echo "    export OCH_EDGE_IP=$ip" >&2
  echo "    curl --cacert certs/dev-root.pem --resolve ${host}:443:${ip} https://${host}/api/readyz" >&2
  echo "  Add stable DNS for Node/Playwright (needs /etc/hosts pointing at MetalLB IP, not 127.0.0.1):" >&2
  echo "    sudo sh -c 'grep -qF \"$ip $host\" /etc/hosts || echo \"$ip $host\" >> /etc/hosts'" >&2
  echo "  Or: OCH_AUTO_EDGE_HOSTS=1 (uses OCH_EDGE_IP or discovered LB IP; requires sudo on non-root)" >&2
}

# Idempotent append to /etc/hosts when user opts in (fixes headless / CI agents without split DNS).
edge_maybe_auto_hosts() {
  local host="$1"
  local ip="$2"
  [[ "${OCH_AUTO_EDGE_HOSTS:-0}" != "1" ]] && return 0
  if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "⚠️  OCH_AUTO_EDGE_HOSTS=1 but IP invalid: $ip" >&2
    return 1
  fi
  if grep -qE "[[:space:]]${host}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
    return 0
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    printf '%s %s\n' "$ip" "$host" >>/etc/hosts
    echo "✅ Appended $ip $host to /etc/hosts (root)" >&2
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    printf '%s %s\n' "$ip" "$host" | sudo tee -a /etc/hosts >/dev/null
    echo "✅ Appended $ip $host to /etc/hosts (sudo)" >&2
    return 0
  fi
  echo "❌ OCH_AUTO_EDGE_HOSTS=1 but cannot write /etc/hosts (need root or sudo)" >&2
  return 1
}

# Exit 1 if hostname does not resolve (e.g. missing /etc/hosts → MetalLB).
edge_require_host_resolves() {
  local base="$1"
  local host
  host="$(edge_hostname_from_https_url "$base")"
  if [[ -z "$host" || "$host" == "$base" ]]; then
    echo "❌ Could not parse hostname from $base" >&2
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket; socket.gethostbyname(\"$host\")" >/dev/null 2>&1 && return 0
  fi
  if command -v python >/dev/null 2>&1; then
    python -c "import socket; socket.gethostbyname(\"$host\")" >/dev/null 2>&1 && return 0
  fi
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$host" >/dev/null 2>&1 && return 0
  fi
  echo "❌ Hostname $host does not resolve. Map it to your MetalLB IP in /etc/hosts (see edge_print_resolve_and_hosts_hint)." >&2
  return 1
}
