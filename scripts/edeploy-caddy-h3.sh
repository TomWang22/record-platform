#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
kubectl -n "$NS" apply -f k8s/caddy-h3-configmap.yaml
kubectl -n "$NS" apply -f k8s/caddy-h3-deploy.yaml
kubectl -n "$NS" apply -f k8s/caddy-h3-svc.yaml
kubectl -n "$NS" rollout status deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=100 | egrep -i 'HTTP/3 listener|server running|protocols' || true
