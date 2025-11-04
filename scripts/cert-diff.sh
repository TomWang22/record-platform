# file: scripts/cert-diff.sh  (compare Ingress vs Caddy leaf/issuer)
#!/usr/bin/env bash
set -euo pipefail
NS_CADDY=ingress-nginx
NS_ING=record-platform
LEAF_SEC=record-local-tls

echo "== Ingress TLS secret (record-platform/${LEAF_SEC}) =="
kubectl -n "$NS_ING" get secret "$LEAF_SEC" -o jsonpath='{.data.tls\.crt}' \
 | base64 -D | openssl x509 -noout -subject -issuer -dates

echo; echo "== Leaf served by Caddy (mounted cert) =="
POD=$(kubectl -n "$NS_CADDY" get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}')
kubectl -n "$NS_CADDY" exec "$POD" -- sh -lc 'openssl x509 -in /etc/caddy/certs/tls.crt -noout -subject -issuer -dates'
