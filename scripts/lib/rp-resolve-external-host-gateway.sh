#!/usr/bin/env bash
# Resolve the IP Kubernetes pods should use for host-published Compose ports (Redis, Postgres, etc.).
# Pods reach host.docker.internal via hostAliases → this gateway IP, not the Compose bridge (172.18.0.x).
# shellcheck disable=SC2034
rp_resolve_external_host_gateway_ip() {
  local ip="${HOST_GATEWAY_IP:-}"
  if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$ip"
    return 0
  fi

  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"

  if [[ "$ctx" == *"k3d"* ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      ip="$(docker network inspect k3d-record-platform --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
      [[ "$ip" == "<no value>" || -z "$ip" ]] && ip="172.20.0.1"
    else
      ip="$(docker run --rm --network k3d-record-platform alpine getent hosts host.k3d.internal 2>/dev/null | awk '{print $1}' || true)"
      [[ -z "$ip" ]] && ip="172.20.0.1"
    fi
    echo "$ip"
    return 0
  fi

  if [[ "$ctx" == *"colima"* ]]; then
    if command -v colima >/dev/null 2>&1; then
      ip="$(colima ssh -- ip route show default 2>/dev/null | awk '{print $3}' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
    fi
    echo "${ip:-192.168.5.2}"
    return 0
  fi

  ip="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return 0
  fi

  echo "192.168.5.2"
}
