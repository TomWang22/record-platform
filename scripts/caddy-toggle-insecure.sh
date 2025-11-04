# file: scripts/caddy-toggle-insecure.sh  (TEMP: prove it's TLS trust)
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx

# Add tls_insecure_skip_verify and comment out tls_trust_pool in Caddyfile transport
[[ -f ./Caddyfile ]] || { echo "ERROR: ./Caddyfile not found"; exit 1; }
tmp=$(mktemp)
awk '
  BEGIN{in_transport=0}
  /transport http \{/ {in_transport=1}
  { 
    if (in_transport && $0 ~ /^[[:space:]]*tls_trust_pool /) { print "#" $0; next }
    print
  }
  in_transport && /}/ {
    print "      tls_insecure_skip_verify"
    in_transport=0
  }
' ./Caddyfile > "$tmp" && mv "$tmp" ./Caddyfile

kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -
kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status  deploy/caddy-h3