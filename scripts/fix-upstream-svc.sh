# file: scripts/fix-upstream-svc.sh
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx

echo "== Detecting ingress-nginx controller Service =="
SVC=$(kubectl -n "$NS" get svc -l app.kubernetes.io/component=controller -o jsonpath='{.items[0].metadata.name}')
if [[ -z "${SVC:-}" ]]; then
  echo "ERROR: Could not find a controller Service in namespace $NS" >&2
  kubectl -n "$NS" get svc -o wide
  exit 1
fi
echo "Detected controller Service: $SVC"

# Update Caddyfile upstream host to the detected service FQDN
FQDN="${SVC}.${NS}.svc.cluster.local"
echo "Patching Caddyfile reverse_proxy upstream to: https://${FQDN}:443"

# Fail if Caddyfile not present
[[ -f ./Caddyfile ]] || { echo "ERROR: ./Caddyfile not found"; exit 1; }

# Replace any previous ingress service FQDN line inside the reverse_proxy block
tmp=$(mktemp)
# robust: replace any 'reverse_proxy https://<anything>:443 {' line with the new FQDN
awk -v host="${FQDN}" '
  BEGIN{re= "^\\s*reverse_proxy\\s+https://[^[:space:]]+:443\\s*\\{"}
  {
    if ($0 ~ re) {
      sub(re, "  reverse_proxy https://" host ":443 {")
    }
    print
  }' ./Caddyfile > "$tmp"

mv "$tmp" ./Caddyfile

# Apply ConfigMap and restart Caddy
kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile=./Caddyfile \
  -o yaml --dry-run=client | kubectl apply -f -

kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status  deploy/caddy-h3

echo "Done. Caddy now proxies to https://${FQDN}:443"