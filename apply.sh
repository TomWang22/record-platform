#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
INGRESS_FILE=${INGRESS_FILE:-./infra/k8s/overlays/dev/ingress.yaml}

kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile=./Caddyfile \
  -o yaml --dry-run=client | kubectl apply -f -

kubectl -n "$NS" apply -f ./caddy-deploy.yaml
kubectl -n "$NS" apply -f ./caddy-svc.yaml

if [[ -f "$INGRESS_FILE" ]]; then
  echo "Applying ingress: $INGRESS_FILE"
  kubectl apply -f "$INGRESS_FILE"
else
  echo "WARNING: Ingress file not found at $INGRESS_FILE (skipping). Set INGRESS_FILE=... if needed." >&2
fi

kubectl -n "$NS" rollout status deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=120 | egrep -i 'HTTP/3|server running|protocols|listening' || true