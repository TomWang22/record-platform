#!/usr/bin/env bash
# Colima + k3s start args — MetalLB-only edge requires k3s ServiceLB + traefik disabled.
# shellcheck shell=bash

# Populate caller's array with Colima argv (no printf/mapfile — avoids comma/backslash mangling).
# Usage: colima_args=(); rp_colima_build_start_argv colima_args; colima "${colima_args[@]}"
rp_colima_build_start_argv() {
  local -n _out=$1
  local cpu="${2:-12}" memory="${3:-16}" disk="${4:-256}" k3s_version="${5:-v1.29.6+k3s1}"
  local use_vz="${RP_COLIMA_USE_VZ:-1}"

  _out=(
    start
    --kubernetes
    --cpu "$cpu"
    --memory "$memory"
    --disk "$disk"
    --network-address
  )
  if [[ "$use_vz" == "1" ]]; then
    _out+=(--vm-type vz)
  fi
  if [[ -n "$k3s_version" ]]; then
    _out+=(--kubernetes-version "$k3s_version")
  fi
  # Two k3s-arg entries (no comma in a single value — Colima/k3s-install can split on commas).
  _out+=(--k3s-arg "--disable=servicelb")
  _out+=(--k3s-arg "--disable=traefik")
}

rp_colima_print_start_argv() {
  local -n _args=$1
  printf 'colima argv:'
  printf ' %q' colima "${_args[@]}"
  printf '\n'
}

# Authoritative: systemd ExecStart argv (Colima single-node often shows only "k3s agent" in ps).
rp_colima_k3s_systemd_execstart_argv() {
  colima ssh -- sudo systemctl show k3s -p ExecStart --value 2>/dev/null | tr '\n' ' ' || true
}

rp_colima_k3s_systemd_execstart() {
  colima ssh -- sudo systemctl cat k3s 2>/dev/null \
    | sed -n '/^ExecStart=/,/^$/p' || true
}

rp_colima_k3s_server_ps_line() {
  colima ssh -- ps auxww 2>/dev/null | grep -E '[k]3s server|[k]3s agent' | head -1 || true
}

rp_colima_k3s_disable_flags_in_text() {
  local text="$1"

  if [[ "$text" == *'servicelb\'* ]] || [[ "$text" == *'--disable=servicelb\'* ]]; then
    return 2
  fi
  if [[ "$text" == *'@server'* ]]; then
    return 3
  fi

  local has_servicelb=0 has_traefik=0
  if [[ "$text" == *'--disable=servicelb'* ]] || [[ "$text" == *'--disable servicelb'* ]]; then
    has_servicelb=1
  fi
  if [[ "$text" == *'--disable=traefik'* ]] || [[ "$text" == *'--disable traefik'* ]]; then
    has_traefik=1
  fi
  if [[ "$text" == *'--disable=servicelb,traefik'* ]]; then
    has_servicelb=1
    has_traefik=1
  fi

  if [[ "$has_servicelb" -ne 1 || "$has_traefik" -ne 1 ]]; then
    return 1
  fi
  return 0
}

rp_colima_verify_k3s_disable_flags() {
  local systemd_argv execstart ps_line rc

  systemd_argv="$(rp_colima_k3s_systemd_execstart_argv)"
  execstart="$(rp_colima_k3s_systemd_execstart)"
  ps_line="$(rp_colima_k3s_server_ps_line)"

  if [[ -z "$systemd_argv" ]]; then
    echo "❌ could not read k3s ExecStart from systemctl (is k3s.service active?)" >&2
    return 1
  fi

  set +e
  rp_colima_k3s_disable_flags_in_text "$systemd_argv"
  rc=$?
  set -e
  case "$rc" in
    0) ;;
    2)
      echo "❌ malformed disable arg detected: --disable=servicelb\\" >&2
      echo "❌ expected k3s disable flags: servicelb and traefik" >&2
      echo "❌ actual k3s systemd ExecStart argv: ${systemd_argv}" >&2
      return 1
      ;;
    3)
      echo "❌ invalid @server suffix in k3s disable flags" >&2
      echo "❌ actual k3s systemd ExecStart argv: ${systemd_argv}" >&2
      return 1
      ;;
    *)
      echo "❌ k3s systemd ExecStart missing --disable=servicelb and/or --disable=traefik" >&2
      echo "❌ expected k3s disable flags: servicelb and traefik" >&2
      echo "❌ actual k3s systemd ExecStart argv: ${systemd_argv}" >&2
      [[ -n "$execstart" ]] && echo "--- systemctl cat k3s ExecStart ---" >&2 && echo "$execstart" >&2
      return 1
      ;;
  esac

  echo "✅ k3s server disables servicelb and traefik (systemd ExecStart)"
  if [[ -n "$ps_line" ]]; then
    echo "  ℹ️  ps: ${ps_line}"
  else
    echo "  ℹ️  ps: no 'k3s server' line (Colima single-node may show only k3s agent — systemd is authoritative)"
  fi
  return 0
}

rp_colima_verify_no_servicelb() {
  local ns="${1:-kube-system}"
  if ! rp_colima_verify_k3s_disable_flags; then
    return 1
  fi
  local hits=""
  hits="$(kubectl get ds,pods -n "$ns" 2>/dev/null | grep -E 'svclb|servicelb|klipper' || true)"
  if [[ -n "$hits" ]]; then
    echo "❌ k3s ServiceLB components still present in ${ns}:" >&2
    echo "$hits" >&2
    echo "❌ k3s systemd ExecStart: $(rp_colima_k3s_systemd_execstart_argv)" >&2
    return 1
  fi
  return 0
}
