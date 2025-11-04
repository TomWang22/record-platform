#!/usr/bin/env bash
set -euo pipefail
NS="${NS:-record-platform}"
POD_PATH="infra/k8s/overlays/dev/pods/postgres-postinit-debugger.yaml"
CM_PATH="infra/k8s/overlays/dev/jobs/postgres-postinit-sql-cm.yaml"

[[ -f "$CM_PATH" ]]  || { echo "Missing $CM_PATH"; exit 1; }
[[ -f "$POD_PATH" ]] || { echo "Missing $POD_PATH"; exit 1; }

echo "→ Ensuring postinit SQL ConfigMap exists"
kubectl -n "$NS" apply -f "$CM_PATH"

echo "→ Recreating debug Pod"
kubectl -n "$NS" delete pod/postgres-postinit-debugger --ignore-not-found
kubectl -n "$NS" apply -f "$POD_PATH"

echo "→ Streaming logs (will keep running)"
kubectl -n "$NS" logs -f pod/postgres-postinit-debugger --container psql

echo "Tip: when done, delete the pod:"
echo "kubectl -n $NS delete pod/postgres-postinit-debugger"
