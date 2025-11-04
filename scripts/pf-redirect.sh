#!/usr/bin/env bash
set -euo pipefail
# Use only if hostPort is 8443 in kind cluster config.
sudo bash -c 'cat >/etc/pf.anchors/h3-redirect <<EOF
rdr pass on lo0 proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443
rdr pass on lo0 proto udp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443
EOF'
sudo bash -c 'printf "%s\n" \
  "rdr-anchor \"h3-redirect\"" \
  "load anchor \"h3-redirect\" from \"/etc/pf.anchors/h3-redirect\"" \
  > /tmp/pf-h3.conf'
sudo pfctl -f /tmp/pf-h3.conf
sudo pfctl -E >/dev/null 2>&1 || true