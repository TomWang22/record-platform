#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
echo "== Pods ==" && kubectl -n "$NS" get pods -l app=caddy-h3 -o wide || true
POD=$(kubectl -n "$NS" get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "${POD}" ]]; then
  echo "== No pod yet; recent events ==" && kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 30
  exit 0
fi
echo; echo "== Pod events =="; kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p'
echo; echo "== Caddy tail =="; kubectl -n "$NS" logs "$POD" --tail=200 || true
NODE=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.nodeName}')
echo; echo "== Node :443 ownership ($NODE) ==";
kubectl debug node/"$NODE" -it --image=busybox -- chroot /host sh -c 'ss -nltp | grep ":443" || true; ss -nulp | grep ":443" || true' || true