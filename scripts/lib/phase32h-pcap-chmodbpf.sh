#!/usr/bin/env bash
# Phase 32H — ChmodBPF / access_bpf capture prerequisites (no sudo).
set -euo pipefail

phase32h_dumpcap_bin() {
  if [[ -n "${PHASE32H_DUMPCAP_BIN:-}" ]]; then
    echo "$PHASE32H_DUMPCAP_BIN"
    return 0
  fi
  if command -v dumpcap >/dev/null 2>&1; then
    command -v dumpcap
    return 0
  fi
  if [[ -x /opt/homebrew/bin/dumpcap ]]; then
    echo /opt/homebrew/bin/dumpcap
    return 0
  fi
  return 1
}

phase32h_assert_chmodbpf() {
  if ! id -Gn | tr ' ' '\n' | grep -qx access_bpf; then
    echo "BLOCKED: user not in access_bpf group (install wireshark-chmodbpf and re-login)" >&2
    return 2
  fi
  if [[ ! -r /dev/bpf0 ]]; then
    echo "BLOCKED: /dev/bpf0 not readable (ChmodBPF not active)" >&2
    return 2
  fi
  local dumpcap_bin
  dumpcap_bin="$(phase32h_dumpcap_bin)" || {
    echo "BLOCKED: dumpcap not found" >&2
    return 2
  }
  if ! "$dumpcap_bin" -D >/dev/null 2>&1; then
    echo "BLOCKED: dumpcap -D failed without sudo" >&2
    "$dumpcap_bin" -D >&2 || true
    return 2
  fi
  return 0
}

phase32h_resolve_capture_iface() {
  local host="${PHASE32H_CAPTURE_HOST:-record-platform.test}"
  local iface=""
  iface="$(
    route -n get "$host" 2>/dev/null |
      awk '/interface:/{print $2; exit}'
  )"
  if [[ -z "$iface" ]]; then
    iface="${PHASE32H_PCAP_IFACE:-en0}"
  fi
  echo "$iface"
}

phase32h_pcap_tcp_443_count() {
  local pcap="$1"
  if command -v tshark >/dev/null 2>&1; then
    tshark -r "$pcap" -Y 'tcp.port == 443' -T fields -e frame.number 2>/dev/null | wc -l | tr -d '[:space:]'
    return 0
  fi
  tcpdump -r "$pcap" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]'
}

phase32h_pcap_udp_443_count() {
  local pcap="$1"
  if command -v tshark >/dev/null 2>&1; then
    tshark -r "$pcap" -Y 'udp.port == 443' -T fields -e frame.number 2>/dev/null | wc -l | tr -d '[:space:]'
    return 0
  fi
  tcpdump -r "$pcap" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]'
}
