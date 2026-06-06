#!/usr/bin/env bash
# Colima VM DNS readiness (fresh VM often cannot resolve until resolv.conf is patched).
rp_colima_vm_ensure_dns() {
  local max="${RP_COLIMA_VM_DNS_WAIT_SEC:-180}"
  local elapsed=0

  # Bridged Colima VMs often default to 192.168.5.1 which is not a working resolver immediately after boot.
  colima ssh -- sudo sh -c '
    for ns in 1.1.1.1 8.8.8.8; do
      grep -q "^nameserver ${ns}" /etc/resolv.conf 2>/dev/null || echo "nameserver ${ns}" >> /etc/resolv.conf
    done
    # lima sometimes leaves a broken search domain first
    if [ -f /etc/resolv.conf ] && ! getent hosts ports.ubuntu.com >/dev/null 2>&1; then
      sed -i "1i nameserver 1.1.1.1" /etc/resolv.conf 2>/dev/null || true
    fi
  ' 2>/dev/null || true

  while [[ "$elapsed" -lt "$max" ]]; do
    if colima ssh -- sh -c 'getent hosts ports.ubuntu.com >/dev/null 2>&1 || getent hosts archive.ubuntu.com >/dev/null 2>&1'; then
      return 0
    fi
    printf '[rp-colima-vm-dns] waiting for VM DNS (%ss / %ss)\n' "$elapsed" "$max" >&2
    sleep 5
    elapsed=$((elapsed + 5))
  done
  return 1
}
