#!/usr/bin/env bash
# Install curl with HTTP/3 (QUIC) support inside the Colima VM so in-VM curl has --http3-only.
# Run from the Mac: colima ssh -- bash -s < scripts/install-curl-http3-colima-vm.sh
# Or from inside the VM (after colima ssh): bash -s < /path/to/install-curl-http3-colima-vm.sh
#
# Uses compscidr/curl-http3-deb repo (Ubuntu 22.04/jammy). For Ubuntu 24.04 the jammy packages may
# work; if not, the script suggests building from source (see docs).
set -euo pipefail

echo "=== Installing curl with HTTP/3 (ngtcp2) in Colima VM ==="
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  echo "Detected: $ID $VERSION_ID"
else
  echo "Cannot detect OS; trying jammy repo."
fi

# One-liner for copy-paste (run inside VM after: colima ssh):
# curl -sSL https://raw.githubusercontent.com/compscidr/curl-http3-deb/main/install.sh | sudo bash
# Or add repo and install:
install_via_repo() {
  if command -v curl &>/dev/null && curl --help all 2>/dev/null | grep -q -- "--http3-only"; then
    echo "curl already has --http3-only: $(curl --version | head -1)"
    return 0
  fi
  # compscidr repo (jammy = 22.04)
  sudo apt-get update -qq
  if [[ "$VERSION_ID" == "24.04" ]] || [[ "$VERSION_ID" == "24.10" ]]; then
    echo "Ubuntu $VERSION_ID: trying jammy repo (may work); if install fails, build from source (see script comments)."
  fi
  echo "deb [trusted=yes] https://apt.fury.io/compscidr/ /" | sudo tee /etc/apt/sources.list.d/curl-http3.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y curl 2>/dev/null || {
    echo "Repo install failed. Install manually:"
    echo "  See https://github.com/compscidr/curl-http3-deb"
    echo "  Or build from source: https://curl.se/docs/http3.html"
    return 1
  }
  if curl --help all 2>/dev/null | grep -q -- "--http3-only"; then
    echo "Installed: $(curl --version | head -1)"
    echo "Test: curl -k --http3-only https://record.local/_caddy/healthz --resolve record.local:443:192.168.5.240"
    return 0
  else
    echo "Installed curl but --http3-only not found; rebuild from source with ngtcp2."
    return 1
  fi
}

install_via_repo
