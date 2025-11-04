# file: scripts/point-caddy-to-ingress.sh
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx

# Find the controller service exposing 443 (works with Helm defaults)
SVC=$(kubectl -n "$NS" get svc -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{range .spec.ports[*]}{.port}{" "}{end}{"\n"}{end}' \
  | awk -F'|' '{ has443=0; n=split($2,a," "); for(i=1;i<=n;i++) if(a[i]=="443") has443=1; if(has443 && $1 ~ /ingress.*nginx.*controller/) {print $1; exit} }')

if [[ -z "${SVC:-}" ]]; then
  echo "ERROR: No ingress-nginx controller Service with 443 in $NS"; kubectl -n "$NS" get svc; exit 1
fi
FQDN="${SVC}.${NS}.svc.cluster.local"
echo "Will use upstream: https://${FQDN}:443"

# Replace the upstream line in Caddyfile
[[ -f ./Caddyfile ]] || { echo "ERROR: ./Caddyfile not found"; exit 1; }
tmp=$(mktemp)
awk -v host="$FQDN" '
  BEGIN{re="^\\s*reverse_proxy\\s+https://[^[:space:]]+:443\\s*\\{"}
  { if ($0 ~ re) { sub(re, "  reverse_proxy https://" host ":443 {") } print }
' ./Caddyfile > "$tmp" && mv "$tmp" ./Caddyfile

# Reapply + restart
kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -
kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status  deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=80 | egrep -i 'error|listening|HTTP/3|server running' || true