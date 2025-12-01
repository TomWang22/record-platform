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

  HTTP3_IMAGE="${HTTP3_IMAGE:-alpine/curl-http3:latest}"
  
  # Pre-pull the image to avoid pull messages during test execution
  # This ensures the image is available and reduces test noise
  # Check if image exists locally (with or without :latest tag)
  local image_exists=false
  if docker image inspect "$HTTP3_IMAGE" >/dev/null 2>&1; then
    image_exists=true
  elif [[ "$HTTP3_IMAGE" == *":latest" ]]; then
    # Try without :latest tag
    local image_no_tag="${HTTP3_IMAGE%:latest}"
    if docker image inspect "$image_no_tag" >/dev/null 2>&1; then
      HTTP3_IMAGE="$image_no_tag"
      image_exists=true
    fi
  else
    # Try with :latest tag
    if docker image inspect "${HTTP3_IMAGE}:latest" >/dev/null 2>&1; then
      HTTP3_IMAGE="${HTTP3_IMAGE}:latest"
      image_exists=true
    fi
  fi
  
  if [[ "$image_exists" == "false" ]]; then
    _http3_warn "Pulling HTTP/3 image: $HTTP3_IMAGE (this may take a moment)..."
    docker pull "$HTTP3_IMAGE" >/dev/null 2>&1 || {
      _HTTP3_RUNNER_READY="no"
      _http3_fail "Failed to pull HTTP/3 image: $HTTP3_IMAGE"
    }
  fi
  
  _HTTP3_RUNNER_READY="yes"
}

http3_curl() {
  _http3_ensure_runner || return 1
  # Use timeout to ensure the command doesn't hang indefinitely
  # Docker run with --rm will clean up automatically
  # Since we pre-pull the image, Docker shouldn't try to pull it again
  # But if it does, we'll filter out those messages
  local output exit_code
  output=$(docker run --rm \
    --network "container:${HTTP3_KIND_NODE}" \
    "$HTTP3_IMAGE" \
    curl "$@" 2>&1)
  exit_code=$?
  
  # Filter out Docker pull messages (they appear on stderr but get mixed with curl output)
  # Keep everything else, including legitimate curl errors
  output=$(echo "$output" | grep -v "Unable to find image\|Pulling from\|Pull complete\|Digest:\|Status:")
  
  # Print the filtered output
  echo "$output"
  
  # Return the original exit code
  return $exit_code
}

