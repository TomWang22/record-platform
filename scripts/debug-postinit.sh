# =========================================
# file: scripts/debug-postinit.sh
# Run the debug job using the correct path and robust log streaming.
# =========================================
#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"
JOB_PATH="infra/k8s/overlays/dev/jobs/postgres-postinit-debug.yaml"
CM_PATH="infra/k8s/overlays/dev/jobs/postgres-postinit-sql-cm.yaml"
JOB_NAME="postgres-postinit-debug"

echo "== Checking files exist =="
[[ -f "$CM_PATH" ]]  || { echo "Missing $CM_PATH"; exit 1; }
[[ -f "$JOB_PATH" ]] || { echo "Missing $JOB_PATH"; exit 1; }

echo "== Ensuring ConfigMap and Job =="
kubectl -n "$NS" apply -f "$CM_PATH"
kubectl -n "$NS" delete job/$JOB_NAME --ignore-not-found
kubectl -n "$NS" apply -f "$JOB_PATH"

echo "== Streaming job logs (will not wait on Ready) =="
kubectl -n "$NS" logs -f job/$JOB_NAME --tail=200 || true

echo "== Waiting for completion (or fast-fail) =="
if ! kubectl -n "$NS" wait --for=condition=Complete job/$JOB_NAME --timeout=15m; then
  echo "Job did not complete. Diagnostics:"
  kubectl -n "$NS" describe job/$JOB_NAME || true
  # last pod (if any)
  POD="$(kubectl -n "$NS" get pods -l job-name=$JOB_NAME -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${POD:-}" ]]; then
    kubectl -n "$NS" describe pod "$POD" || true
    kubectl -n "$NS" logs "$POD" --all-containers --tail=500 || true
    kubectl -n "$NS" logs "$POD" --all-containers --tail=200 --previous || true
  else
    echo "No job pods present."
  fi
  exit 1
fi

echo "== Debug post-init completed."