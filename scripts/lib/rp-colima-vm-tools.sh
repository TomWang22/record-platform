#!/usr/bin/env bash
# Install capture/debug tools inside the Colima VM (Z.colima_clean).
# apt/apk output → bench_logs/command-logs/Z.colima_clean/05-vm-tools*.log (not main terminal).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export RP_CB_REPO_ROOT="${RP_CB_REPO_ROOT:-$REPO_ROOT}"
export RP_CB_BENCH="${RP_CB_BENCH:-$REPO_ROOT/bench_logs}"
export RP_CB_CURRENT_PHASE="${RP_CB_CURRENT_PHASE:-Z.colima_clean}"

# shellcheck source=rp-colima-running.sh
source "$SCRIPT_DIR/rp-colima-running.sh"
# shellcheck source=rp-colima-vm-dns.sh
source "$SCRIPT_DIR/rp-colima-vm-dns.sh"
# shellcheck source=rp-cold-bootstrap-lib.sh
source "$SCRIPT_DIR/rp-cold-bootstrap-lib.sh"

_COLIMA_PHASE="Z.colima_clean"
RP_VM_TOOLS_INSTALL_EXTRA="${RP_VM_TOOLS_INSTALL_EXTRA:-1}"

if ! command -v colima >/dev/null 2>&1; then
  printf '❌ colima not on PATH\n' >&2
  exit 1
fi
if ! rp_colima_is_running; then
  printf '❌ Colima is not running\n' >&2
  exit 1
fi
if ! colima ssh -- true 2>/dev/null; then
  printf '❌ colima ssh failed\n' >&2
  exit 1
fi

_vm_has_cmd() {
  colima ssh -- sh -c "command -v $1 >/dev/null 2>&1" 2>/dev/null
}

_install_core_apt() {
  local attempt
  for attempt in 1 2 3; do
    if rp_run_logged "$_COLIMA_PHASE" "05-vm-tools-apt-${attempt}" \
      "Install VM tools (apt attempt ${attempt}/3)" \
      colima ssh -- sudo DEBIAN_FRONTEND=noninteractive sh -c \
      'apt-get update -qq && apt-get install -y -qq tcpdump tshark htop strace perf 2>/dev/null || apt-get install -y -qq tcpdump tshark htop strace'; then
      return 0
    fi
    printf '⚠️  apt core install failed — refreshing VM DNS and retrying\n'
    rp_colima_vm_ensure_dns || true
    sleep 5
  done
  return 1
}

_install_core_apk() {
  rp_run_logged "$_COLIMA_PHASE" "05-vm-tools-apk" "Install VM tools (apk)" \
    colima ssh -- sudo sh -c \
    'apk update -q && apk add --no-cache tcpdump wireshark-cli htop strace'
}

_install_golang_apt() {
  rp_run_logged "$_COLIMA_PHASE" "06-vm-tools-golang" "Install golang-go in VM" \
    colima ssh -- sudo DEBIAN_FRONTEND=noninteractive sh -c \
    'apt-get update -qq && apt-get install -y -qq golang-go'
}

_install_xcaddy() {
  if _vm_has_cmd xcaddy; then
    return 0
  fi
  if ! _vm_has_cmd go; then
    printf '⚠️  go not in VM — skip xcaddy\n'
    return 1
  fi
  rp_run_logged "$_COLIMA_PHASE" "07-vm-tools-xcaddy" "Install xcaddy in VM" \
    colima ssh -- bash -lc '
    set -e
    export PATH="/usr/local/go/bin:/usr/lib/go/bin:$HOME/go/bin:$PATH"
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
    sudo install -m 0755 "$(go env GOPATH)/bin/xcaddy" /usr/local/bin/xcaddy
    xcaddy version
  '
}

if ! rp_colima_vm_ensure_dns; then
  gate_fail "$_COLIMA_PHASE" "VM DNS not ready before apt install"
  exit 1
fi

_need_core=0
for c in tcpdump tshark htop strace; do
  if ! _vm_has_cmd "$c"; then
    _need_core=1
    break
  fi
done

if [[ "$_need_core" -eq 1 ]]; then
  if _vm_has_cmd apt-get; then
    _install_core_apt || {
      gate_fail "$_COLIMA_PHASE" "VM tools apt install failed"
      exit 1
    }
  elif _vm_has_cmd apk; then
    _install_core_apk || {
      gate_fail "$_COLIMA_PHASE" "VM tools apk install failed"
      exit 1
    }
  else
    printf '❌ Colima VM has neither apt-get nor apk\n' >&2
    exit 1
  fi
fi

for c in tcpdump tshark htop strace; do
  _vm_has_cmd "$c" || {
    gate_fail "$_COLIMA_PHASE" "VM tools install failed (missing $c)"
    exit 1
  }
done

if [[ "$RP_VM_TOOLS_INSTALL_EXTRA" == "1" ]]; then
  if _vm_has_cmd apt-get && ! _vm_has_cmd go; then
    _install_golang_apt || printf '⚠️  golang-go install skipped\n'
  fi
  _install_xcaddy || printf '⚠️  xcaddy not installed in VM (non-fatal)\n'
fi

_installed=""
for c in tcpdump tshark htop strace; do
  _vm_has_cmd "$c" && _installed+=" $c"
done
_vm_has_cmd perf && _installed+=" perf"
_vm_has_cmd xcaddy && _installed+=" xcaddy"

printf '✅ VM tools installed:%s\n' "$_installed"
printf '  logs: %s/command-logs/%s/05-vm-tools*.log\n' "$RP_CB_BENCH" "$_COLIMA_PHASE"
