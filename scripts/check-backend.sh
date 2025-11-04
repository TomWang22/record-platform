# file: scripts/check-backend.sh  (run only if /api/healthz fails)
#!/usr/bin/env bash
set -euo pipefail
NS=record-platform
echo "== Services/Pods pointing to your ingress backend =="
kubectl -n "$NS" get svc,pod -o wide | egrep 'NAME|nginx|api|gateway' || true

echo; echo "== Ingress routes =="
kubectl -n "$NS" get ingress -o yaml | sed -n '1,160p'

echo; echo "== Test ingress from inside the cluster (bypass Caddy) =="
kubectl -n "$NS" run curlx --restart=Never --image=curlimages/curl -- \
  sh -lc 'curl -sSkI https://record.local/api/healthz || true'
kubectl -n "$NS" wait --for=condition=Ready pod/curlx --timeout=60s || true
kubectl -n "$NS" logs curlx || true
kubectl -n "$NS" delete pod curlx --now >/dev/null 2>&1 || true