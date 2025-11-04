# file: scripts/patch-caddy-upstream.sh
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
FQDN=$(cat /tmp/ingress-controller-fqdn.txt 2>/dev/null || true)
[[ -z "$FQDN" ]] && { echo "ERROR: missing /tmp/ingress-controller-fqdn.txt; run scripts/find-ingress-svc.sh first"; exit 1; }
[[ -f ./Caddyfile ]] || { echo "ERROR: ./Caddyfile not found"; exit 1; }

# Replace any reverse_proxy https://<something>:443 { … } with the detected FQDN
tmp=$(mktemp)
awk -v host="$FQDN" '
  BEGIN{re="^\\s*reverse_proxy\\s+https://[^[:space:]]+:443\\s*\\{"}
  { if ($0 ~ re) { sub(re, "  reverse_proxy https://" host ":443 {") } print }
' ./Caddyfile > "$tmp"
mv "$tmp" ./Caddyfile

# Apply ConfigMap + restart Caddy
kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -
kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status  deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=60 | egrep -i 'error|listening|HTTP/3|server running' || true