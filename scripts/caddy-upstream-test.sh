# file: scripts/caddy-upstream-test.sh  (from inside the Caddy pod)
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
SVC=ingress-nginx-controller
POD=$(kubectl -n "$NS" get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}')
IP=$(kubectl -n "$NS" get svc "$SVC" -o jsonpath='{.spec.clusterIP}')
echo "Caddy POD=$POD, Ingress IP=$IP"

# H2 via Caddy netns to ingress service with Host/SNI record.local
kubectl -n "$NS" exec "$POD" -- sh -lc "
  set -e
  echo '== From Caddy pod -> ingress (H2) =='
  apk add -q --no-cache curl >/dev/null 2>&1 || true
  curl -sSkI --connect-timeout 5 --max-time 10 \
    --http2 --resolve record.local:443:$IP https://record.local/api/healthz | head -n1