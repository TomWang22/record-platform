#!/usr/bin/env bash
set -euo pipefail
echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts >/dev/null
# If kind maps 443->8443, keep pf; otherwise remove it.
sudo bash -c 'cat >/etc/pf.anchors/h3-redirect <<EOF
rdr pass on lo0 proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443
rdr pass on lo0 proto udp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443
EOF'
sudo bash -c 'printf "%s\n" \
  "rdr-anchor \"h3-redirect\"" \
  "load anchor \"h3-redirect\" from \"/etc/pf.anchors/h3-redirect\"" \
  > /tmp/pf-h3.conf'
sudo pfctl -f /tmp/pf-h3.conf; sudo pfctl -E >/dev/null 2>&1 || true

# H2 and H3 to Caddy
/opt/homebrew/opt/curl/bin/curl -I --http2      -H 'Host: record.local' https://record.local/_caddy/healthz
/opt/homebrew/opt/curl/bin/curl -I --http3-only -H 'Host: record.local' https://record.local/_caddy/healthz

# In-cluster Caddy→Ingress
NS=ingress-nginx
kubectl -n "$NS" run t --rm -it --image=curlimages/curl -- \
  sh -lc '
    VIP=$(getent hosts caddy-h3.ingress-nginx.svc.cluster.local | awk "{print \$1; exit}");
    echo "Caddy VIP=$VIP";
    curl -sSkI --resolve record.local:443:$VIP https://record.local/_caddy/healthz;
    curl -sSkI --resolve record.local:443:$VIP https://record.local/api/healthz;