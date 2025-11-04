# ==================================================
# FILE: scripts/rollout-caddy.sh  (root)  — unchanged, shown for completeness
# ==================================================
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -
kubectl -n "$NS" apply -f ./caddy-deploy.yaml
kubectl -n "$NS" rollout status deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=200 | egrep -i 'HTTP/3 listener|server running|protocols|http.log.error|x509|verify|dial|lookup' || true