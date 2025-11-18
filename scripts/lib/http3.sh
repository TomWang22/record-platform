#!/usr/bin/env bash

# Shared helpers for issuing HTTP/3 requests against the kind cluster by
# reusing the control-plane node's network namespace. This avoids macOS/Docker
# UDP limitations so QUIC traffic reliably reaches the in-cluster Caddy pod.

_http3_fail() {
  if declare -F fail >/dev/null 2>&1; then
    fail "$1"
  else
    echo "HTTP/3 helper error: $1" >&2
    exit 1
  fi
}

_http3_warn() {
  if declare -F warn >/dev/null 2>&1; then
    warn "$1"
  else
    echo "HTTP/3 helper warning: $1" >&2
  fi
}

_http3_detect_kind_node() {
  local cluster="${HTTP3_KIND_CLUSTER:-${KIND_CLUSTER:-h3}}"
  local node=""
  if command -v kind >/dev/null 2>&1; then
    node="$(kind get nodes --name "$cluster" 2>/dev/null | head -n1 || true)"
    if [[ -z "$node" ]]; then
      node="$(kind get nodes 2>/dev/null | head -n1 || true)"
    fi
  fi
  [[ -n "$node" ]] || return 1
  echo "$node"
}

_HTTP3_RUNNER_READY=""

_http3_ensure_runner() {
  if [[ "$_HTTP3_RUNNER_READY" == "yes" ]]; then
    return 0
  elif [[ "$_HTTP3_RUNNER_READY" == "no" ]]; then
    return 1
  fi

  command -v docker >/dev/null 2>&1 || {
    _HTTP3_RUNNER_READY="no"
    _http3_fail "Docker is required for HTTP/3 tests."
  }

  local node="${HTTP3_KIND_NODE:-}"
  if [[ -z "$node" ]]; then
    node="$(_http3_detect_kind_node)" || {
      _HTTP3_RUNNER_READY="no"
      _http3_fail "Unable to detect kind node; set HTTP3_KIND_NODE manually."
    }
    HTTP3_KIND_NODE="$node"
  fi

  HTTP3_IMAGE="${HTTP3_IMAGE:-alpine/curl-http3}"
  _HTTP3_RUNNER_READY="yes"
}

http3_curl() {
  _http3_ensure_runner || return 1
  # Use timeout to ensure the command doesn't hang indefinitely
  # Docker run with --rm will clean up automatically
  docker run --rm \
    --network "container:${HTTP3_KIND_NODE}" \
    "$HTTP3_IMAGE" \
    curl "$@" || {
    # If curl fails, return with exit code 1
    return 1
  }
}

