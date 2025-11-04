# =====================================================================
# 1) DIAG — why rollout hangs?
# =====================================================================
# file: scripts/diag-gateway.sh
#!/usr/bin/env bash
set -euo pipefail
NS=record-platform
echo "== Pods =="; kubectl -n "$NS" get pods -l app=api-gateway -o wide || true
POD=$(kubectl -n "$NS" get pod -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -n "${POD}" ]]; then
  echo; echo "== Pod describe (events) =="; kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p' || true
  echo; echo "== Logs (if running) =="; kubectl -n "$NS" logs "$POD" --tail=200 || true
fi
echo; echo "== Service/Endpoints =="; kubectl -n "$NS" get svc,ep api-gateway -o wide || true