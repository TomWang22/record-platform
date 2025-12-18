#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Apply Caddy resources in order
kubectl -n "$NS" apply -f infra/k8s/caddy-h3-configmap.yaml 2>/dev/null || kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -
kubectl -n "$NS" apply -f infra/k8s/caddy-h3-deploy.yaml
kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
kubectl -n "$NS" rollout status deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=100 | egrep -i 'HTTP/3 listener|server running|protocols' || true
