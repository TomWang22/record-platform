#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx

# 1) Replace Caddyfile site address to listen on :8443
tmp=$(mktemp)
sed 's|^https://record\.local {|https://record.local:8443 {|' ./Caddyfile > "$tmp"
kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile="$tmp" -o yaml --dry-run=client | kubectl apply -f -
rm -f "$tmp"

# 2) Patch Deployment probes + ports to 8443 (TCP/UDP)
kubectl -n "$NS" patch deploy caddy-h3 --type='json' -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/ports/0/containerPort","value":8443},
  {"op":"replace","path":"/spec/template/spec/containers/0/ports/1/containerPort","value":8443},
  {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8443},
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/httpGet/port","value":8443}
]'

# 3) Patch Service targetPorts to 8443 (for in-cluster tests)
kubectl -n "$NS" patch svc caddy-h3 --type='json' -p='[
  {"op":"replace","path":"/spec/ports/0/targetPort","value":8443},
  {"op":"replace","path":"/spec/ports/1/targetPort","value":8443}
]'

# 4) Rollout
kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status deploy/caddy-h3

echo "If you use macOS pf, keep redirect 443->8443 (TCP+UDP)."