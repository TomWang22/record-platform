# file: scripts/diag-caddy.sh
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
echo "== Pods =="; kubectl -n "$NS" get pods -l app=caddy-h3 -o wide || true
POD=$(kubectl -n "$NS" get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "${POD}" ]]; then
  echo "No pod yet. Recent events:"; kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 30; exit 0
fi
echo; echo "== Logs =="; kubectl -n "$NS" logs "$POD" --tail=200 || true
echo; echo "== Events =="; kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p' || true
echo; echo "== Common checks =="
echo "- Secrets present?"; kubectl -n "$NS" get secret record-local-tls dev-root-ca || true
echo "- Controller SVC exists?"; kubectl -n "$NS" get svc ingress-nginx-controller -o wide || true