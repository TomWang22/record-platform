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
  
  # Try to find docker command (check common locations for Colima/k3s)
  local docker_cmd=""
  if command -v docker >/dev/null 2>&1; then
    docker_cmd="docker"
  elif [[ -f "$HOME/.colima/default/docker.sock" ]] || [[ -S "$HOME/.colima/default/docker.sock" ]]; then
    # Colima docker socket exists - try to use it via docker context or direct
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" 2>/dev/null || true
    # Try to find docker in common locations
    for d in /usr/local/bin/docker /opt/homebrew/bin/docker /usr/bin/docker; do
      if [[ -x "$d" ]]; then
        docker_cmd="$d"
        break
      fi
    done
  fi
  
  # First: Check if we're using Colima or k3s (check current kubectl context and cluster type)
  local current_ctx=$(kubectl config current-context 2>/dev/null || echo "")
  local cluster_type=""
  
  # Detect cluster type: check for k3s, colima, or kind
  if kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' 2>/dev/null | grep -q "k3s"; then
    cluster_type="k3s"
  elif [[ "$current_ctx" == *"colima"* ]] || [[ -n "${COLIMA_DOCKER_SOCKET:-}" ]]; then
    cluster_type="colima"
  elif command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q .; then
    cluster_type="kind"
  fi
  
  # For Colima/k3s: Use host network mode (direct access, no container namespace needed)
  if [[ "$cluster_type" == "k3s" ]] || [[ "$cluster_type" == "colima" ]]; then
    echo "HOST_NETWORK"
    return 0
  fi
  
  # For Colima: Try to find container if docker is available
  if [[ "$cluster_type" == "colima" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --format "{{.Names}}" 2>/dev/null | grep -iE "colima|lima" | head -n1 || true)"
    if [[ -n "$node" ]]; then
      echo "$node"
      return 0
    fi
    # Fallback: Use host network mode for Colima
    echo "HOST_NETWORK"
    return 0
  fi
  
  # Second: Try Kind cluster detection
  if [[ "$cluster_type" == "kind" ]] && command -v kind >/dev/null 2>&1; then
    # Try explicit cluster name first
    node="$(kind get nodes --name "$cluster" 2>/dev/null | head -n1 || true)"
    # Fallback: try any Kind cluster
    if [[ -z "$node" ]]; then
      node="$(kind get nodes 2>/dev/null | head -n1 || true)"
    fi
    if [[ -n "$node" ]]; then
      echo "$node"
      return 0
    fi
  fi
  
  # Fallback: try to detect from Docker containers (for Kind clusters)
  if [[ -z "$node" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --filter "name=${cluster}-" --filter "name=kind-" --format "{{.Names}}" 2>/dev/null | grep -E "(control-plane|worker)" | head -n1 || true)"
  fi
  
  # Fallback: try to find any container with "kind" or cluster name in the name
  if [[ -z "$node" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --format "{{.Names}}" 2>/dev/null | grep -iE "(kind|${cluster})" | head -n1 || true)"
  fi
  
  # Last resort: find any Kubernetes node container (h3-control-plane, h3-worker, etc.)
  if [[ -z "$node" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --format "{{.Names}}" 2>/dev/null | grep -E "(control-plane|worker)" | head -n1 || true)"
  fi
  
  # If still no node found and we have a cluster, default to HOST_NETWORK for Colima/k3s
  if [[ -z "$node" ]] && kubectl get nodes >/dev/null 2>&1; then
    # Assume Colima/k3s if we can reach the cluster but can't find a container node
    echo "HOST_NETWORK"
    return 0
  fi
  
  [[ -n "$node" ]] || return 1
  echo "$node"
}

_HTTP3_RUNNER_READY=""
_HTTP3_DOCKER_CMD=""

_http3_ensure_runner() {
  if [[ "$_HTTP3_RUNNER_READY" == "yes" ]]; then
    return 0
  elif [[ "$_HTTP3_RUNNER_READY" == "no" ]]; then
    return 1
  fi

  # Try to find docker command (check common locations for Colima/k3s)
  local docker_cmd=""
  if command -v docker >/dev/null 2>&1; then
    docker_cmd="docker"
  elif [[ -S "$HOME/.colima/default/docker.sock" ]] || [[ -f "$HOME/.colima/default/docker.sock" ]]; then
    # Colima docker socket exists - try to use it
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" 2>/dev/null || true
    # Try to find docker in common locations
    for d in /usr/local/bin/docker /opt/homebrew/bin/docker /usr/bin/docker; do
      if [[ -x "$d" ]]; then
        docker_cmd="$d"
        break
      fi
    done
  fi
  
  # If using HOST_NETWORK, we don't strictly need docker (but still need it for the image)
  # For HOST_NETWORK mode, we can use podman or any container runtime
  if [[ -z "$docker_cmd" ]]; then
    # Check if we're using HOST_NETWORK (Colima/k3s) - in that case, try to find alternative
    local detected_node="$(_http3_detect_kind_node 2>/dev/null || echo "")"
    if [[ "$detected_node" == "HOST_NETWORK" ]]; then
      # For HOST_NETWORK, we can try podman or warn but continue
      if command -v podman >/dev/null 2>&1; then
        docker_cmd="podman"
      else
        _HTTP3_RUNNER_READY="no"
        _http3_fail "Docker or Podman is required for HTTP/3 tests. Install docker or set DOCKER_HOST."
      fi
    else
      _HTTP3_RUNNER_READY="no"
      _http3_fail "Docker is required for HTTP/3 tests. Install docker or set DOCKER_HOST."
    fi
  fi
  
  # Store docker command globally for use in http3_curl
  _HTTP3_DOCKER_CMD="$docker_cmd"

  local node="${HTTP3_KIND_NODE:-}"
  if [[ -z "$node" ]]; then
    node="$(_http3_detect_kind_node)" || {
      _HTTP3_RUNNER_READY="no"
      _http3_fail "Unable to detect kind node; set HTTP3_KIND_NODE manually."
    }
    HTTP3_KIND_NODE="$node"
  fi

  # Prefer enhanced image (tcpdump, tshark, valgrind) when available; else alpine/curl-http3
  local default_image="alpine/curl-http3:latest"
  if docker image inspect "http3-curl-enhanced:latest" >/dev/null 2>&1; then
    default_image="http3-curl-enhanced:latest"
  fi
  HTTP3_IMAGE="${HTTP3_IMAGE:-$default_image}"
  
  # Pre-pull the image to avoid pull messages during test execution
  local image_exists=false
  if docker image inspect "$HTTP3_IMAGE" >/dev/null 2>&1; then
    image_exists=true
  elif [[ "$HTTP3_IMAGE" == *":latest" ]]; then
    local image_no_tag="${HTTP3_IMAGE%:latest}"
    if docker image inspect "$image_no_tag" >/dev/null 2>&1; then
      HTTP3_IMAGE="$image_no_tag"
      image_exists=true
    fi
  else
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
  
  local output exit_code
  
  # Use docker command found during _http3_ensure_runner
  local docker_cmd="${_HTTP3_DOCKER_CMD:-docker}"
  
  # Ensure PATH includes common locations
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  
  # Fallback: try to find docker if not set
  if [[ -z "$docker_cmd" ]] || ! command -v "$docker_cmd" >/dev/null 2>&1; then
    if command -v docker >/dev/null 2>&1; then
      docker_cmd="docker"
    elif [[ -S "$HOME/.colima/default/docker.sock" ]] || [[ -f "$HOME/.colima/default/docker.sock" ]]; then
      export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" 2>/dev/null || true
      # Try common locations
      for d in /usr/local/bin/docker /opt/homebrew/bin/docker /usr/bin/docker; do
        if [[ -x "$d" ]]; then
          docker_cmd="$d"
          break
        fi
      done
    fi
  fi
  
  # Verify docker command works
  if ! command -v "$docker_cmd" >/dev/null 2>&1 && [[ -z "${DOCKER_HOST:-}" ]]; then
    _http3_warn "Docker command not found - HTTP/3 tests will fail. Install docker or set DOCKER_HOST."
    return 1
  fi
  
  # Extract --cacert argument and mount the certificate file if present
  local cacert_path=""
  local curl_args=()
  local mount_args=()
  local args_array=("$@")
  local i=0
  while [[ $i -lt ${#args_array[@]} ]]; do
    local arg="${args_array[$i]}"
    if [[ "$arg" == "--cacert" ]] && [[ $((i+1)) -lt ${#args_array[@]} ]]; then
      local cert_file="${args_array[$((i+1))]}"
      if [[ -f "$cert_file" ]] && [[ -s "$cert_file" ]]; then
        # Mount the certificate file into the container
        # Use a simple, predictable path inside the container
        cacert_path="/tmp/ca-cert.pem"
        # Ensure the file is readable and use absolute path for mount
        local abs_cert_file
        if [[ "$cert_file" = /* ]]; then
          # Already absolute path
          abs_cert_file="$cert_file"
        else
          # Convert to absolute path
          abs_cert_file="$(cd "$(dirname "$cert_file")" && pwd)/$(basename "$cert_file")"
        fi
        # Verify file exists and is readable before mounting
        if [[ -r "$abs_cert_file" ]] && [[ -s "$abs_cert_file" ]]; then
          # Mount to /tmp to avoid directory conflicts
          # Use a unique filename to avoid conflicts
          cacert_path="/tmp/http3-ca-$$.pem"
          # For --network host, we need to ensure the file is mounted correctly
          # Try mounting as a file explicitly
          mount_args+=("-v" "$abs_cert_file:$cacert_path:ro")
          curl_args+=("--cacert" "$cacert_path")
          i=$((i+2))
          continue
        else
          _http3_warn "CA certificate file not readable or empty: $abs_cert_file"
        fi
      else
        _http3_warn "CA certificate file not found or empty: $cert_file"
      fi
    fi
    curl_args+=("$arg")
    i=$((i+1))
  done
  
  # Check if we should use host network (for Colima/k3s or when no container network available)
  if [[ "$HTTP3_KIND_NODE" == "HOST_NETWORK" ]]; then
    # Use host network mode - works for Colima/k3s and direct host access
    # For host network, we need to resolve to 127.0.0.1 with the correct port
    # Replace any --resolve arguments that use service IP with 127.0.0.1
    local final_curl_args=()
    local i=0
    while [[ $i -lt ${#curl_args[@]} ]]; do
      local arg="${curl_args[$i]}"
      if [[ "$arg" == "--resolve" ]] && [[ $((i+1)) -lt ${#curl_args[@]} ]]; then
        local resolve_val="${curl_args[$((i+1))]}"
        # Extract host:port:ip from resolve value
        if [[ "$resolve_val" =~ ^([^:]+):([0-9]+):(.+)$ ]]; then
          local resolve_host="${BASH_REMATCH[1]}"
          local resolve_port="${BASH_REMATCH[2]}"
          local resolve_ip="${BASH_REMATCH[3]}"
          # If IP is a service IP (10.x.x.x), replace with 127.0.0.1
          # For HTTP/3 with NodePort, we need to use the NodePort (typically 30443)
          # HTTP/3 (QUIC) uses UDP, but still needs to go through NodePort
          if [[ "$resolve_ip" =~ ^10\. ]] || [[ "$resolve_ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] || [[ "$resolve_ip" =~ ^192\.168\. ]]; then
            # Detect NodePort from environment or use default
            local nodeport="${CADDY_NODEPORT:-${PORT:-30443}}"
            # Use 127.0.0.1 with NodePort for HTTP/3
            resolve_val="${resolve_host}:${nodeport}:127.0.0.1"
            # Also update the URL port if it's using default 443
            local url_idx=0
            for ((url_i=0; url_i<${#final_curl_args[@]}; url_i++)); do
              if [[ "${final_curl_args[$url_i]}" =~ ^https://${resolve_host}(:443)?(/.*)?$ ]]; then
                # Replace :443 with :${nodeport} in URL
                final_curl_args[$url_i]="${final_curl_args[$url_i]//:443/:${nodeport}}"
                # If no port specified, add NodePort
                if [[ "${final_curl_args[$url_i]}" =~ ^https://${resolve_host}/ ]]; then
                  final_curl_args[$url_i]="${final_curl_args[$url_i]//https:\/\/${resolve_host}\//https:\/\/${resolve_host}:${nodeport}\/}"
                fi
              fi
            done
          fi
        fi
        final_curl_args+=("--resolve" "$resolve_val")
        i=$((i+2))
        continue
      fi
      final_curl_args+=("$arg")
      i=$((i+1))
    done
    
    # Update any URL arguments to use NodePort instead of 443
    # This is needed for HTTP/3 with NodePort setup
    local nodeport="${CADDY_NODEPORT:-${PORT:-30443}}"
    for ((url_idx=0; url_idx<${#final_curl_args[@]}; url_idx++)); do
      local url_arg="${final_curl_args[$url_idx]}"
      # Match URLs like https://host:443/path or https://host/path
      if [[ "$url_arg" =~ ^https://([^:/]+)(:443)?(/.*)?$ ]]; then
        local host_part="${BASH_REMATCH[1]}"
        local path_part="${BASH_REMATCH[3]:-/}"
        # Replace with NodePort
        final_curl_args[$url_idx]="https://${host_part}:${nodeport}${path_part}"
      fi
    done
    
    # For --network host, volume mounts may not work reliably with Colima
    # Use base64 encoding to pass CA cert content via environment variable
    local ca_cert_b64=""
    local source_ca_file=""
    if [[ ${#mount_args[@]} -gt 0 ]]; then
      # Extract the source file path from mount_args (format: -v /path/to/file:/dest:ro)
      for ((j=0; j<${#mount_args[@]}; j++)); do
        if [[ "${mount_args[$j]}" == "-v" ]] && [[ $((j+1)) -lt ${#mount_args[@]} ]]; then
          local mount_spec="${mount_args[$((j+1))]}"
          source_ca_file="${mount_spec%%:*}"
          if [[ -f "$source_ca_file" ]] && [[ -r "$source_ca_file" ]]; then
            # Base64 encode to avoid shell escaping issues
            ca_cert_b64=$(base64 < "$source_ca_file" | tr -d '\n')
            # Remove the mount args since we'll use env var instead
            mount_args=()
            break
          fi
        fi
      done
    fi
    
    # If we have CA cert, pass it via base64 env var and decode in container
    if [[ -n "$ca_cert_b64" ]] && [[ -n "$source_ca_file" ]]; then
      # Find --cacert argument and update path
      local updated_curl_args=()
      local cert_path="/tmp/http3-ca-cert.pem"
      local i=0
      while [[ $i -lt ${#final_curl_args[@]} ]]; do
        if [[ "${final_curl_args[$i]}" == "--cacert" ]] && [[ $((i+1)) -lt ${#final_curl_args[@]} ]]; then
          updated_curl_args+=("--cacert" "$cert_path")
          i=$((i+2))
        else
          updated_curl_args+=("${final_curl_args[$i]}")
          i=$((i+1))
        fi
      done
      final_curl_args=("${updated_curl_args[@]}")
      
      # Create file in container by decoding base64
      # Build the curl command string carefully to avoid shell injection
      local curl_cmd_parts=()
      for arg in "${final_curl_args[@]}"; do
        # Escape single quotes and wrap in single quotes
        local escaped_arg=$(printf '%s\n' "$arg" | sed "s/'/'\"'\"'/g")
        curl_cmd_parts+=("'$escaped_arg'")
      done
      
      local curl_cmd_str=$(IFS=' '; echo "${curl_cmd_parts[*]}")
      
      output=$($docker_cmd run --rm \
        --network host \
        -e "CA_CERT_B64=$ca_cert_b64" \
        "$HTTP3_IMAGE" \
        sh -c "echo \"\$CA_CERT_B64\" | base64 -d > $cert_path && curl $curl_cmd_str" 2>&1)
      exit_code=$?
    else
      # Fallback to mount if no CA cert (shouldn't happen, but safe fallback)
      output=$($docker_cmd run --rm \
        --network host \
        "${mount_args[@]}" \
        "$HTTP3_IMAGE" \
        curl "${final_curl_args[@]}" 2>&1)
      exit_code=$?
    fi
  else
    # Use container network namespace (for Kind clusters)
    output=$($docker_cmd run --rm \
      --network "container:${HTTP3_KIND_NODE}" \
      "${mount_args[@]}" \
      "$HTTP3_IMAGE" \
      curl "${curl_args[@]}" 2>&1)
    exit_code=$?
  fi
  
  # Filter out Docker pull messages (they appear on stderr but get mixed with curl output)
  # Keep everything else, including legitimate curl errors
  output=$(echo "$output" | grep -v "Unable to find image\|Pulling from\|Pull complete\|Digest:\|Status:")
  
  # Print the filtered output
  echo "$output"
  
  # Return the original exit code
  return $exit_code
}

