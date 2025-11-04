#!/usr/bin/env bash
set -euo pipefail
NS=${NS:-record-platform}

echo "▶ In-cluster checks"
kubectl -n "$NS" run netshoot --restart=Never --image=nicolaka/netshoot -- sleep 120 >/dev/null
kubectl -n "$NS" exec netshoot -- sh -lc '
for u in \
  http://api-gateway:4000/healthz \
  http://haproxy:8081/healthz \
  http://nginx:8080/healthz \
  http://nginx:8080/api/healthz
do
  printf "  %-36s -> " "$u"
  code=$(wget -qS -O- "$u" 2>&1 | sed -n "s/^  HTTP\/1\.1 \([0-9][0-9][0-9]\).*/\1/p" | tail -1)
  [ -z "$code" ] && code=000
  echo "$code"
done'
kubectl -n "$NS" delete pod netshoot --now >/dev/null

echo; echo "▶ Local port-forward"
pgrep -f "kubectl.*port-forward.*svc/nginx.*8080:8080" >/dev/null || kubectl -n "$NS" port-forward svc/nginx 8080:8080 >/dev/null 2>&1 &
sleep 1
for u in http://localhost:8080/healthz http://localhost:8080/api/healthz; do
  printf "  %-36s -> " "$u"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$u" || true)
  echo "$code"
done
