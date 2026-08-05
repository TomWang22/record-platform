#!/usr/bin/env bash
# Resolve a pod-routable endpoint for an external dependency by proven execution plane.
#
# Required inputs (env):
#   TARGET_EXECUTION_PLANE  — K3S_SERVICE | COLIMA_DEFAULT_DOCKER_CONTAINER |
#                             MACOS_NATIVE_PROCESS | MACOS_FORWARDED_PORT |
#                             REMOTE_ENDPOINT | UNKNOWN_BLOCKING
#   TARGET_SERVICE          — logical name (e.g. redis, postgres-records)
#   TARGET_PORT             — published / service port
#   TARGET_PROTOCOL         — redis | postgresql | tcp (informational)
#   COLIMA_PROFILE          — default: default
#
# Optional:
#   RP_EXTERNAL_ENDPOINT_IP — explicit override (must still match plane rules)
#
# Outputs (stdout, one line each as KEY=value when RP_RESOLVE_EMIT_KV=1; else selected IP only):
#   selected_route selected_ip resolution_source listener_owner protocol_probe
#   application_probe selection_reason
#
# Fail closed: never silently fall back between Colima VM node IP and macOS gateway.
# shellcheck disable=SC2034

rp_resolve_external_dependency_endpoint() {
  local plane="${TARGET_EXECUTION_PLANE:-}"
  local service="${TARGET_SERVICE:-}"
  local port="${TARGET_PORT:-}"
  local protocol="${TARGET_PROTOCOL:-tcp}"
  local profile="${COLIMA_PROFILE:-default}"
  local override="${RP_EXTERNAL_ENDPOINT_IP:-}"

  local selected_route="" selected_ip="" resolution_source="" listener_owner=""
  local protocol_probe="not_run" application_probe="not_run" selection_reason=""

  _rp_emit() {
    if [[ "${RP_RESOLVE_EMIT_KV:-0}" == "1" ]]; then
      printf 'selected_route=%s\n' "$selected_route"
      printf 'selected_ip=%s\n' "$selected_ip"
      printf 'resolution_source=%s\n' "$resolution_source"
      printf 'listener_owner=%s\n' "$listener_owner"
      printf 'protocol_probe=%s\n' "$protocol_probe"
      printf 'application_probe=%s\n' "$application_probe"
      printf 'selection_reason=%s\n' "$selection_reason"
    else
      printf '%s\n' "$selected_ip"
    fi
  }

  _rp_fail() {
    selection_reason="$1"
    selected_route="FAIL_CLOSED"
    selected_ip=""
    resolution_source="none"
    listener_owner="unknown"
    echo "❌ rp_resolve_external_dependency_endpoint: $selection_reason" >&2
    return 1
  }

  if [[ -z "$plane" || -z "$service" || -z "$port" ]]; then
    _rp_fail "TARGET_EXECUTION_PLANE, TARGET_SERVICE, and TARGET_PORT are required"
    return 1
  fi

  case "$plane" in
    UNKNOWN_BLOCKING)
      _rp_fail "TARGET_EXECUTION_PLANE=UNKNOWN_BLOCKING — refuse to patch endpoints"
      return 1
      ;;
    K3S_SERVICE)
      selected_route="K8S_SERVICE_DNS"
      selected_ip=""
      resolution_source="kubernetes_dns"
      listener_owner="k8s_service:${service}"
      selection_reason="Use Kubernetes Service DNS for in-cluster dependencies"
      protocol_probe="deferred_to_caller"
      application_probe="deferred_to_caller"
      _rp_emit
      return 0
      ;;
    COLIMA_DEFAULT_DOCKER_CONTAINER)
      local vm_ip=""
      if [[ -n "$override" ]]; then
        vm_ip="$override"
        resolution_source="RP_EXTERNAL_ENDPOINT_IP"
      else
        if command -v colima >/dev/null 2>&1; then
          vm_ip="$(colima status --profile "$profile" 2>&1 | sed -n 's/.*address:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1 || true)"
          [[ -z "$vm_ip" ]] && vm_ip="$(colima list 2>/dev/null | awk -v p="$profile" 'NR>1 && $1==p {print $NF; exit}' || true)"
        fi
        resolution_source="colima_profile_address"
      fi
      vm_ip="$(echo "$vm_ip" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
      if [[ -z "$vm_ip" ]]; then
        _rp_fail "COLIMA_DEFAULT_DOCKER_CONTAINER requires Colima VM address for profile=$profile (no silent fallback to macOS gateway)"
        return 1
      fi
      # Reject using macOS gateway when plane is Colima container
      local lima_gw=""
      if command -v colima >/dev/null 2>&1; then
        lima_gw="$(colima ssh --profile "$profile" -- getent hosts host.lima.internal 2>/dev/null | awk '{print $1}' | head -1 || true)"
      fi
      if [[ -n "$lima_gw" && "$vm_ip" == "$lima_gw" ]]; then
        _rp_fail "resolved IP $vm_ip equals host.lima.internal — refusing to treat macOS gateway as COLIMA_DEFAULT_DOCKER_CONTAINER endpoint"
        return 1
      fi
      selected_route="COLIMA_VM_PUBLISHED_PORT"
      selected_ip="$vm_ip"
      listener_owner="colima_docker:${profile}:${service}"
      selection_reason="Compose container in Colima profile ${profile}; use VM published ${vm_ip}:${port}"
      protocol_probe="deferred_to_caller"
      application_probe="deferred_to_caller"
      _rp_emit
      return 0
      ;;
    MACOS_NATIVE_PROCESS|MACOS_FORWARDED_PORT)
      local gw=""
      if [[ -n "$override" ]]; then
        gw="$override"
        resolution_source="RP_EXTERNAL_ENDPOINT_IP"
      else
        if command -v colima >/dev/null 2>&1; then
          gw="$(colima ssh --profile "$profile" -- getent hosts host.lima.internal 2>/dev/null | awk '{print $1}' | head -1 || true)"
          resolution_source="host.lima.internal"
        fi
      fi
      gw="$(echo "$gw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
      if [[ -z "$gw" ]]; then
        _rp_fail "${plane} requires host.lima.internal resolution inside Colima profile=$profile (no silent fallback to node InternalIP)"
        return 1
      fi
      local node_ip=""
      node_ip="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
      if [[ -n "$node_ip" && "$gw" == "$node_ip" ]]; then
        _rp_fail "host.lima.internal resolved to node InternalIP ($gw) — refusing macOS gateway derived from K3s node address"
        return 1
      fi
      selected_route="MACOS_HOST_GATEWAY"
      selected_ip="$gw"
      listener_owner="macos:${plane}:${service}"
      selection_reason="macOS-owned or macOS-forwarded listener; use host.lima.internal → ${gw}:${port}"
      protocol_probe="deferred_to_caller"
      application_probe="deferred_to_caller"
      _rp_emit
      return 0
      ;;
    REMOTE_ENDPOINT)
      if [[ -z "$override" ]]; then
        _rp_fail "REMOTE_ENDPOINT requires RP_EXTERNAL_ENDPOINT_IP"
        return 1
      fi
      selected_route="REMOTE_ENDPOINT"
      selected_ip="$override"
      resolution_source="RP_EXTERNAL_ENDPOINT_IP"
      listener_owner="remote:${service}"
      selection_reason="Explicit remote endpoint override"
      protocol_probe="deferred_to_caller"
      application_probe="deferred_to_caller"
      _rp_emit
      return 0
      ;;
    *)
      _rp_fail "unsupported TARGET_EXECUTION_PLANE=$plane"
      return 1
      ;;
  esac
}

# Back-compat shim: emergency hostAliases only. Does NOT choose between planes.
# Prefer rp_resolve_external_dependency_endpoint with an explicit plane.
rp_resolve_external_host_gateway_ip() {
  echo "⚠️  rp_resolve_external_host_gateway_ip is emergency-only; set TARGET_EXECUTION_PLANE explicitly" >&2
  if [[ -n "${HOST_GATEWAY_IP:-}" ]] && [[ "${HOST_GATEWAY_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$HOST_GATEWAY_IP"
    return 0
  fi
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" == *"k3d"* ]]; then
    local ip=""
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
  # Colima: resolve host.lima.internal only — never node InternalIP, never hardcode swap.
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    local gw
    gw="$(colima ssh -- getent hosts host.lima.internal 2>/dev/null | awk '{print $1}' | head -1 || true)"
    gw="$(echo "$gw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
    if [[ -z "$gw" ]]; then
      echo "❌ cannot resolve host.lima.internal for emergency hostAliases" >&2
      return 1
    fi
    echo "$gw"
    return 0
  fi
  echo "❌ no emergency gateway resolution for context=$ctx" >&2
  return 1
}
