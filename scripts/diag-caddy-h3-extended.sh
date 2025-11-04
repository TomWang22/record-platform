#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
APP=app=caddy-h3

echo "== Pods =="
kubectl -n "$NS" get pods -l "$APP" -o wide || true
POD=$(kubectl -n "$NS" get pod -l "$APP" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
[[ -z "${POD}" ]] && { echo "No pod found. Recent events:"; kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 40; exit 1; }

echo; echo "== Pod conditions =="
kubectl -n "$NS" get pod "$POD" -o json | jq '.status | {phase,conditions,containerStatuses}'

echo; echo "== Pod events =="
kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p'

echo; echo "== Container last state =="
kubectl -n "$NS" get pod "$POD" -o json | jq '.status.containerStatuses[0] | {ready,state,lastState,restartCount,image}'

echo; echo "== Full logs (latest) =="
kubectl -n "$NS" logs "$POD" --tail=500 || true
echo; echo "== Full logs (previous, if any) =="
kubectl -n "$NS" logs "$POD" --previous --tail=200 || true

echo; echo "== Node socket holders on 443 (TCP/UDP) =="
NODE=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.nodeName}')
kubectl debug node/"$NODE" -it --image=busybox -- chroot /host sh -c '
  echo "-- TCP :443 --"; ss -nltp | grep ":443" || true;
  echo "-- UDP :443 --"; ss -nulp | grep ":443" || true;
' || true

echo; echo "== In-pod Caddyfile validate (best-effort) =="
kubectl -n "$NS" exec "$POD" -- caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
