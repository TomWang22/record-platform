# file: scripts/diag-caddy-h3.sh
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
echo "== Pods =="
kubectl -n "$NS" get pods -l app=caddy-h3 -o wide
echo
POD=$(kubectl -n "$NS" get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "${POD}" ]]; then
  echo "No pod yet. Checking events…"
  kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 25
  exit 0
fi
echo "== Describe Pod =="
kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p'
echo
PHASE=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.status.phase}')
if [[ "$PHASE" == "Running" ]]; then
  echo "== Caddy log tail =="
  kubectl -n "$NS" logs "$POD" --tail=200 | tail -n 200
fi
echo
echo "== Node :443 in-use check =="
NODE=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.nodeName}')
echo "Node: ${NODE}"
# Busybox with nsenter to check sockets in the node's netns
kubectl debug node/"$NODE" -it --image=busybox -- chroot /host sh -c 'ss -nltp | grep ":443" || true; ss -nulp | grep ":443" || true' || true